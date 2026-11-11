import { describe, expect, it } from 'vitest'
import { resolvers } from './index.js'
import {
  assertHandlerMatchesKind,
  classifyMutation,
  classifyQuery,
} from './resolverAccessPolicy.js'

describe('resolver access policy coverage', () => {
  it('classifies every Query root field and requires the matching guard', () => {
    const names = Object.keys(resolvers.Query).sort()
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const kind = classifyQuery(name)
      expect(kind, `Query.${name} missing from access allowlists`).not.toBeNull()
      assertHandlerMatchesKind(
        `Query.${name}`,
        kind!,
        resolvers.Query[name as keyof typeof resolvers.Query] as (
          ...args: never[]
        ) => unknown,
      )
    }
  })

  it('classifies every Mutation root field and requires the matching guard', () => {
    const names = Object.keys(resolvers.Mutation).sort()
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const kind = classifyMutation(name)
      expect(kind, `Mutation.${name} missing from access allowlists`).not.toBeNull()
      assertHandlerMatchesKind(
        `Mutation.${name}`,
        kind!,
        resolvers.Mutation[name as keyof typeof resolvers.Mutation] as (
          ...args: never[]
        ) => unknown,
      )
    }
  })
})
