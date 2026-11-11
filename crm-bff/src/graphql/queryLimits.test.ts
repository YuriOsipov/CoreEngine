import { buildSchema, parse, validate } from 'graphql'
import { describe, expect, it } from 'vitest'
import { createQueryLimitsRule } from './queryLimits.js'

const schema = buildSchema(`
  type Nested { child: Nested value: String }
  type Query { root: Nested }
`)

function errorsFor(source: string, maxDepth = 3, maxFields = 10): string[] {
  const rule = createQueryLimitsRule({ maxDepth, maxFields })
  return validate(schema, parse(source), [rule]).map((error) => error.message)
}

describe('createQueryLimitsRule', () => {
  it('allows shallow queries', () => {
    expect(errorsFor('{ root { value } }')).toEqual([])
  })

  it('rejects over-deep nesting', () => {
    const messages = errorsFor(
      '{ root { child { child { child { value } } } } }',
      3,
      50,
    )
    expect(messages.some((message) => /depth/i.test(message))).toBe(true)
  })

  it('counts aliases toward the field budget', () => {
    const aliases = Array.from({ length: 12 }, (_, index) => `a${index}: value`).join(' ')
    const messages = errorsFor(`{ root { ${aliases} } }`, 5, 10)
    expect(messages.some((message) => /fields/i.test(message))).toBe(true)
  })

  it('counts fragment spreads toward depth and fields', () => {
    const messages = errorsFor(
      `
      fragment Deep on Nested { child { child { child { value } } } }
      { root { ...Deep } }
      `,
      3,
      50,
    )
    expect(messages.some((message) => /depth/i.test(message))).toBe(true)
  })
})
