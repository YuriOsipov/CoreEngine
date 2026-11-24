import { describe, expect, it } from 'vitest'
import { stripAutomationsFromBackendConfig } from './recordAutomations.js'

describe('stripAutomationsFromBackendConfig', () => {
  it('removes automations while keeping other backend_config keys', () => {
    expect(
      stripAutomationsFromBackendConfig({
        note: 'keep',
        rowLevelSecurity: 'owner',
        automations: [{ id: 'auto_1', setFields: { salary: 1 } }],
      }),
    ).toEqual({
      note: 'keep',
      rowLevelSecurity: 'owner',
    })
  })

  it('returns empty object for empty input', () => {
    expect(stripAutomationsFromBackendConfig({})).toEqual({})
  })
})
