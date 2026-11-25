import { describe, expect, it } from 'vitest'
import {
  buildListFilter,
  coerceBooleanFilterValue,
  filterConditionComponentProps,
  isApplicableFilterCondition,
  isEmptyFilterValue,
  normalizeConditionValue,
} from '@/core/listFilterUtils'

describe('boolean list filters', () => {
  it('treats false as a real filter value', () => {
    expect(isEmptyFilterValue(false)).toBe(false)
    expect(isEmptyFilterValue(true)).toBe(false)
  })

  it('coerces checkbox / string boolean values', () => {
    expect(coerceBooleanFilterValue(true)).toBe(true)
    expect(coerceBooleanFilterValue(false)).toBe(false)
    expect(coerceBooleanFilterValue('true')).toBe(true)
    expect(coerceBooleanFilterValue('false')).toBe(false)
    expect(coerceBooleanFilterValue([null])).toBeNull()
    expect(coerceBooleanFilterValue(null)).toBeNull()
  })

  it('builds _eq predicates for true and false', () => {
    expect(
      buildListFilter(
        [{ field: 'is_new', operator: '_eq', value: true, type: 'boolean' }],
        'and',
      ),
    ).toEqual({ is_new: { _eq: true } })

    expect(
      buildListFilter(
        [{ field: 'is_new', operator: '_eq', value: false, type: 'boolean' }],
        'and',
      ),
    ).toEqual({ is_new: { _eq: false } })
  })

  it('drops broken non-binary checkbox array values', () => {
    expect(
      isApplicableFilterCondition({
        field: 'is_new',
        operator: '_eq',
        value: [null],
        type: 'boolean',
      }),
    ).toBe(false)

    expect(
      normalizeConditionValue({
        field: 'is_new',
        operator: '_eq',
        value: [null],
        type: 'boolean',
      }),
    ).toBeNull()

    expect(
      buildListFilter(
        [{ field: 'is_new', operator: '_eq', value: [null], type: 'boolean' }],
        'and',
      ),
    ).toEqual({})
  })

  it('forces binary Checkbox props and clears fluid', () => {
    const props = filterConditionComponentProps(
      { field: 'is_new', component: 'Checkbox' },
      { is_new: { fluid: true } },
    )
    expect(props.binary).toBe(true)
    expect(props.fluid).toBeUndefined()
  })
})
