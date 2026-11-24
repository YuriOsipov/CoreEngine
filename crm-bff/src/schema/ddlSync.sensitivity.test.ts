import { describe, expect, it } from 'vitest'
import type { CrmPromotedField } from './crmStorage.js'
import {
  buildSensitivityCommentSql,
  formatSensitivityComment,
  parseSensitivityComment,
  planSensitivityCommentActions,
} from './ddlSync.js'

function promoted(
  apiName: string,
  sensitivity: number,
): CrmPromotedField {
  return {
    apiName,
    fieldType: 'FLOAT',
    pgType: 'double precision',
    needsFkIndex: false,
    needsBtreeIndex: false,
    canDeclareFk: false,
    relatedEntityApiName: null,
    onDelete: null,
    useInSearch: false,
    needsFtsIndex: false,
    ftsConfig: 'simple',
    sensitivity,
  }
}

describe('ddlSync sensitivity comments', () => {
  it('formats and parses the stable marker', () => {
    expect(formatSensitivityComment(2)).toBe('coreengine.sensitivity=2')
    expect(parseSensitivityComment('coreengine.sensitivity=1')).toBe(1)
    expect(
      parseSensitivityComment('note; coreengine.sensitivity=2; extra'),
    ).toBe(2)
    expect(parseSensitivityComment('unrelated comment')).toBeNull()
    expect(parseSensitivityComment(null)).toBeNull()
  })

  it('builds COMMENT ON COLUMN SQL from registry sensitivity', () => {
    expect(
      buildSensitivityCommentSql('crm_schema', 'employee', 'salary', 2),
    ).toBe(
      `COMMENT ON COLUMN "crm_schema"."employee"."salary" IS 'coreengine.sensitivity=2'`,
    )
  })

  it('plans comments for new tables (null existing map)', () => {
    const actions = planSensitivityCommentActions(
      'employee',
      'crm_schema',
      'employee',
      [promoted('salary', 2), promoted('name', 0)],
      null,
    )
    expect(actions.map((a) => a.fieldApiName)).toEqual(['salary', 'name'])
    expect(actions.every((a) => a.type === 'COMMENT_COLUMN')).toBe(true)
    expect(actions[0]?.sql).toContain('sensitivity=2')
  })

  it('plans comment only when marker drifts on existing columns', () => {
    const existing = new Map<string, string | null>([
      ['salary', 'coreengine.sensitivity=1'],
      ['name', 'coreengine.sensitivity=0'],
      ['bonus', null],
    ])
    const actions = planSensitivityCommentActions(
      'employee',
      'crm_schema',
      'employee',
      [
        promoted('salary', 2),
        promoted('name', 0),
        promoted('bonus', 2),
        promoted('open_field', 0),
      ],
      existing,
    )
    expect(actions.map((a) => a.fieldApiName).sort()).toEqual([
      'bonus',
      'salary',
    ])
  })
})
