/**
 * GraphQL validation guards: selection depth + total field count per operation
 * (aliases and fragment spreads are counted, so batching via aliases is bounded).
 */
import {
  GraphQLError,
  Kind,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationRule,
} from 'graphql'

export interface QueryLimitOptions {
  maxDepth: number
  maxFields: number
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isInteger(raw) && raw > 0 ? raw : fallback
}

export function queryLimitOptionsFromEnv(): QueryLimitOptions {
  return {
    maxDepth: positiveIntEnv('GRAPHQL_MAX_DEPTH', 10),
    maxFields: positiveIntEnv('GRAPHQL_MAX_FIELDS', 500),
  }
}

export function createQueryLimitsRule(options: QueryLimitOptions): ValidationRule {
  return (context) => {
    const fragments = new Map<string, FragmentDefinitionNode>()
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(definition.name.value, definition)
      }
    }

    return {
      OperationDefinition(operation) {
        let fieldCount = 0

        const measure = (
          selectionSet: SelectionSetNode,
          depth: number,
          visiting: ReadonlySet<string>,
        ): number => {
          let maxDepth = depth
          for (const selection of selectionSet.selections) {
            if (fieldCount > options.maxFields) break
            if (selection.kind === Kind.FIELD) {
              fieldCount += 1
              if (selection.selectionSet) {
                maxDepth = Math.max(
                  maxDepth,
                  measure(selection.selectionSet, depth + 1, visiting),
                )
              }
            } else if (selection.kind === Kind.INLINE_FRAGMENT) {
              maxDepth = Math.max(maxDepth, measure(selection.selectionSet, depth, visiting))
            } else {
              const name = selection.name.value
              const fragment = fragments.get(name)
              if (!fragment || visiting.has(name)) continue
              maxDepth = Math.max(
                maxDepth,
                measure(fragment.selectionSet, depth, new Set([...visiting, name])),
              )
            }
          }
          return maxDepth
        }

        const depth = measure(operation.selectionSet, 1, new Set())
        if (depth > options.maxDepth) {
          context.reportError(
            new GraphQLError(
              `Query depth ${depth} exceeds maximum of ${options.maxDepth}`,
              { nodes: [operation] },
            ),
          )
        }
        if (fieldCount > options.maxFields) {
          context.reportError(
            new GraphQLError(
              `Query selects more than ${options.maxFields} fields`,
              { nodes: [operation] },
            ),
          )
        }
      },
    }
  }
}
