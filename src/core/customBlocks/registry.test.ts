import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import {
  getCustomBlock,
  isRegisteredCustomBlock,
  listCustomBlocks,
  registerCustomBlock,
  resolveCustomBlockRender,
  unregisterCustomBlock,
} from './registry'

const Stub = defineComponent({ name: 'StubBlock', template: '<div />' })

describe('customBlocks registry', () => {
  it('registers and resolves an extension block', () => {
    unregisterCustomBlock('ClinicVitalsChart')
    registerCustomBlock({
      component: 'ClinicVitalsChart',
      fieldKey: 'vitals_chart',
      label: 'Vital signs',
      render: Stub,
      icon: 'pi-heart',
    })
    expect(isRegisteredCustomBlock('ClinicVitalsChart')).toBe(true)
    expect(getCustomBlock('ClinicVitalsChart')?.fieldKey).toBe('vitals_chart')
    expect(resolveCustomBlockRender({ component: 'ClinicVitalsChart' })).toBe(Stub)
    expect(listCustomBlocks().some((b) => b.component === 'ClinicVitalsChart')).toBe(
      true,
    )
    unregisterCustomBlock('ClinicVitalsChart')
    expect(isRegisteredCustomBlock('ClinicVitalsChart')).toBe(false)
  })

  it('requires component, fieldKey, and render', () => {
    expect(() =>
      registerCustomBlock({
        component: '',
        fieldKey: 'x',
        label: 'X',
        render: Stub,
      }),
    ).toThrow(/component is required/)
  })
})
