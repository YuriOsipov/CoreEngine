import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FTS_CONFIG,
  ftsMatchSql,
  ftsVectorExpr,
  normalizeFtsConfig,
  quoteIdent,
  wantsFullTextSearch,
} from './crmStorage.js'

describe('full-text search helpers', () => {
  it('normalizes allowed configs and falls back to simple', () => {
    expect(normalizeFtsConfig('english')).toBe('english')
    expect(normalizeFtsConfig('ENGLISH')).toBe('english')
    expect(normalizeFtsConfig('nope')).toBe(DEFAULT_FTS_CONFIG)
    expect(normalizeFtsConfig(null)).toBe(DEFAULT_FTS_CONFIG)
  })

  it('only enables FTS for TEXT + fullTextSearch', () => {
    expect(wantsFullTextSearch('TEXT', { fullTextSearch: true })).toBe(true)
    expect(wantsFullTextSearch('TEXT', {})).toBe(false)
    expect(wantsFullTextSearch('STRING', { fullTextSearch: true })).toBe(false)
  })

  it('builds matching GIN / WHERE expressions', () => {
    const col = quoteIdent('body')
    expect(ftsVectorExpr(col, 'simple')).toBe(
      `to_tsvector('simple', coalesce("body", ''))`,
    )
    expect(ftsMatchSql(col, 4, 'english')).toBe(
      `to_tsvector('english', coalesce("body", '')) @@ plainto_tsquery('english', $4)`,
    )
  })
})
