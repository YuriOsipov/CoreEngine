import { describe, expect, it } from 'vitest'
import {
  computePromoPrice,
  pickWinningPromotion,
  promotionMatchesRow,
  type ActivePromotion,
} from './syncPromoPrices.js'

function promo(partial: Partial<ActivePromotion> & { id: string }): ActivePromotion {
  return {
    dateStart: '2024-01-01',
    dateEnd: '2099-12-31',
    itemId: null,
    itemGroupId: null,
    itemPriceGroupId: null,
    promoType: 'discount_percent',
    fixedPrice: null,
    discountPercent: 10,
    ...partial,
  }
}

describe('syncPromoPrices helpers (Activepieces CODE parity)', () => {
  it('computePromoPrice fixed and percent', () => {
    expect(
      computePromoPrice(100, {
        promoType: 'fixed_price',
        fixedPrice: 80,
        discountPercent: null,
      }),
    ).toBe(80)
    expect(
      computePromoPrice(100, {
        promoType: 'discount_percent',
        fixedPrice: null,
        discountPercent: 25,
      }),
    ).toBe(75)
  })

  it('promotionMatchesRow ANDs filled scope fields', () => {
    const row = promo({
      id: 'p1',
      itemGroupId: 'g1',
      itemPriceGroupId: 'pg1',
    })
    expect(promotionMatchesRow(row, 'i1', 'g1', 'pg1')).toBe(true)
    expect(promotionMatchesRow(row, 'i1', 'g2', 'pg1')).toBe(false)
    expect(promotionMatchesRow(promo({ id: 'empty' }), 'i1', 'g1', 'pg1')).toBe(false)
  })

  it('pickWinningPromotion prefers more specific scope then later date_start', () => {
    const winner = pickWinningPromotion([
      promo({ id: 'a', itemGroupId: 'g1', dateStart: '2024-06-01' }),
      promo({ id: 'b', itemId: 'i1', itemGroupId: 'g1', dateStart: '2024-01-01' }),
      promo({ id: 'c', itemPriceGroupId: 'pg1', dateStart: '2024-12-01' }),
    ])
    expect(winner?.id).toBe('b')
  })
})
