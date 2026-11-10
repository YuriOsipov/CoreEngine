import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

export interface EntityRecordAutomationConditionDto {
  field: string
  operator: string
  value?: unknown
  /** literal (default) | field */
  valueSource?: string
  compareField?: string | null
}

export type EntityRecordAutomationActionDto =
  | {
      type: 'notify'
      severity: 'info' | 'warn'
      message: string
    }
  | { type: 'break' }
  | {
      type: 'trigger_flow'
      flowKey: string
    }

export interface EntityRecordAutomationDto {
  id: string
  name: string
  enabled: boolean
  /** Lower runs first. */
  sort: number
  triggers: string[]
  logic: string
  conditions: EntityRecordAutomationConditionDto[]
  requireChanged: string[]
  setFields: Record<string, unknown>
  actions: EntityRecordAutomationActionDto[]
}

const ENTITY_AUTOMATIONS_QUERY = /* GraphQL */ `
  query EntityAutomations($apiName: String!) {
    entitySchema(apiName: $apiName) {
      apiName
      automations {
        id
        name
        enabled
        sort
        triggers
        logic
        conditions {
          field
          operator
          value
          valueSource
          compareField
        }
        requireChanged
        setFields
        actions {
          type
          severity
          message
          flowKey
        }
      }
      fields {
        apiName
        label
        type
        hidden
        isSystem
      }
    }
  }
`

const UPSERT_AUTOMATIONS = /* GraphQL */ `
  mutation UpsertEntityAutomations(
    $entity: String!
    $automations: [EntityRecordAutomationInput!]!
  ) {
    upsertEntityAutomations(entity: $entity, automations: $automations) {
      id
      name
      enabled
      sort
      triggers
      logic
      conditions {
        field
        operator
        value
        valueSource
        compareField
      }
      requireChanged
      setFields
      actions {
        type
        severity
        message
        flowKey
      }
    }
  }
`

export async function fetchEntityAutomations(apiName: string): Promise<{
  automations: EntityRecordAutomationDto[]
  fields: Array<{
    apiName: string
    label: string
    type: string
    hidden: boolean
    isSystem: boolean
  }>
}> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('fetchEntityAutomations')
  }
  const data = await graphqlRequest<{
    entitySchema: {
      automations: EntityRecordAutomationDto[]
      fields: Array<{
        apiName: string
        label: string
        type: string
        hidden: boolean
        isSystem: boolean
      }>
    }
  }>(ENTITY_AUTOMATIONS_QUERY, { apiName })
  return {
    automations: (data.entitySchema.automations ?? []).map((rule, index) => ({
      ...rule,
      sort:
        typeof rule.sort === 'number' && Number.isFinite(rule.sort)
          ? Math.trunc(rule.sort)
          : (index + 1) * 10,
      actions: Array.isArray(rule.actions) ? rule.actions : [],
      setFields:
        rule.setFields && typeof rule.setFields === 'object'
          ? rule.setFields
          : {},
    })),
    fields: data.entitySchema.fields ?? [],
  }
}

export async function upsertEntityAutomations(
  entity: string,
  automations: EntityRecordAutomationDto[],
): Promise<EntityRecordAutomationDto[]> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('upsertEntityAutomations')
  }
  const data = await graphqlRequest<{
    upsertEntityAutomations: EntityRecordAutomationDto[]
  }>(UPSERT_AUTOMATIONS, {
    entity,
    automations: automations.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      sort: rule.sort,
      triggers: rule.triggers,
      logic: rule.logic,
      conditions: rule.conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        value: c.value ?? null,
        valueSource: c.valueSource === 'field' ? 'field' : 'literal',
        compareField: c.valueSource === 'field' ? c.compareField ?? null : null,
      })),
      requireChanged: rule.requireChanged,
      setFields: rule.setFields ?? {},
      actions: (rule.actions ?? []).map((action) => {
        if (action.type === 'break') return { type: 'break' as const }
        if (action.type === 'trigger_flow') {
          return {
            type: 'trigger_flow' as const,
            flowKey: String(action.flowKey || '').trim(),
          }
        }
        return {
          type: 'notify' as const,
          severity: action.severity === 'warn' ? ('warn' as const) : ('info' as const),
          message: action.message,
        }
      }),
    })),
  })
  return (data.upsertEntityAutomations ?? []).map((rule, index) => ({
    ...rule,
    sort:
      typeof rule.sort === 'number' && Number.isFinite(rule.sort)
        ? Math.trunc(rule.sort)
        : (index + 1) * 10,
    actions: Array.isArray(rule.actions) ? rule.actions : [],
    setFields:
      rule.setFields && typeof rule.setFields === 'object' ? rule.setFields : {},
  }))
}
