import { findManyRecords, updateRecord } from '../adapters/records/index.js'
import { fkIdFromValue, readRecordField } from '../adapters/records/relations.js'
import { loadEntityMeta } from '../schema/entityMeta.js'
import { zonedYmd } from './cron.js'

export const PROMO_TYPE_FIXED = 'fixed_price'
export const PROMO_TYPE_PERCENT = 'discount_percent'

export type PromoType = typeof PROMO_TYPE_FIXED | typeof PROMO_TYPE_PERCENT

export interface PromoSyncFieldMap {
  dateStart: string
  dateEnd: string
  item: string
  itemGroup: string
  itemPriceGroup: string
  promoType: string
  fixedPrice: string
  discountPercent: string
  price: string
  promoPrice: string
  promotion: string
  itemPriceItem: string
  itemPriceGroupField: string
  itemGroupField: string
}

export interface PromoSyncParams {
  promotionCollection: string
  itemPriceCollection: string
  itemCollection: string
  fields: PromoSyncFieldMap
}

export interface ActivePromotion {
  id: string
  dateStart: string
  dateEnd: string
  itemId: string | null
  itemGroupId: string | null
  itemPriceGroupId: string | null
  promoType: PromoType
  fixedPrice: number | null
  discountPercent: number | null
}

const DEFAULT_FIELDS: PromoSyncFieldMap = {
  dateStart: 'date_start',
  dateEnd: 'date_end',
  item: 'item',
  itemGroup: 'item_group',
  itemPriceGroup: 'price_group',
  promoType: 'promo_type',
  fixedPrice: 'fixed_price',
  discountPercent: 'discount_percent',
  price: 'price',
  promoPrice: 'promo_price',
  promotion: 'promotion',
  itemPriceItem: 'item',
  itemPriceGroupField: 'price_group',
  itemGroupField: 'group',
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringParam(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return fallback
}

function readField(row: Record<string, unknown>, field: string): unknown {
  return readRecordField(row, field)
}

/** First non-null FK among candidate field names (handles renames / aliases). */
function readFkId(
  row: Record<string, unknown>,
  ...fields: string[]
): string | null {
  for (const field of fields) {
    const trimmed = field.trim()
    if (!trimmed) continue
    const id = fkIdFromValue(readField(row, trimmed))
    if (id) return id
  }
  return null
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toDateString(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    return trimmed.slice(0, 10)
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return null
}

function todayIso(timeZone: string, now = new Date()): string {
  const { year, month, day } = zonedYmd(now, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

export function resolvePromoSyncParams(params: Record<string, unknown>): PromoSyncParams {
  const fieldsIn = asObject(params.fields)
  return {
    promotionCollection: stringParam(params.promotionCollection, 'promotion'),
    itemPriceCollection: stringParam(params.itemPriceCollection, 'item_price'),
    itemCollection: stringParam(params.itemCollection, 'item'),
    fields: {
      dateStart: stringParam(fieldsIn.dateStart, DEFAULT_FIELDS.dateStart),
      dateEnd: stringParam(fieldsIn.dateEnd, DEFAULT_FIELDS.dateEnd),
      item: stringParam(fieldsIn.item, DEFAULT_FIELDS.item),
      itemGroup: stringParam(fieldsIn.itemGroup, DEFAULT_FIELDS.itemGroup),
      itemPriceGroup: stringParam(fieldsIn.itemPriceGroup, DEFAULT_FIELDS.itemPriceGroup),
      promoType: stringParam(fieldsIn.promoType, DEFAULT_FIELDS.promoType),
      fixedPrice: stringParam(fieldsIn.fixedPrice, DEFAULT_FIELDS.fixedPrice),
      discountPercent: stringParam(fieldsIn.discountPercent, DEFAULT_FIELDS.discountPercent),
      price: stringParam(fieldsIn.price, DEFAULT_FIELDS.price),
      promoPrice: stringParam(fieldsIn.promoPrice, DEFAULT_FIELDS.promoPrice),
      promotion: stringParam(fieldsIn.promotion, DEFAULT_FIELDS.promotion),
      itemPriceItem: stringParam(fieldsIn.itemPriceItem, DEFAULT_FIELDS.itemPriceItem),
      itemPriceGroupField: stringParam(
        fieldsIn.itemPriceGroupField,
        DEFAULT_FIELDS.itemPriceGroupField,
      ),
      itemGroupField: stringParam(fieldsIn.itemGroupField, DEFAULT_FIELDS.itemGroupField),
    },
  }
}

export function normalizePromoType(value: unknown): PromoType | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (raw === PROMO_TYPE_FIXED || raw === 'fixed') return PROMO_TYPE_FIXED
  if (
    raw === PROMO_TYPE_PERCENT ||
    raw === 'percent' ||
    raw === 'discount' ||
    raw === 'discount_percent'
  ) {
    return PROMO_TYPE_PERCENT
  }
  return null
}

/** Promo price from list price on the item_price row — never item.base_price. */
export function computePromoPrice(
  listPrice: number,
  promo: Pick<ActivePromotion, 'promoType' | 'fixedPrice' | 'discountPercent'>,
): number {
  if (promo.promoType === PROMO_TYPE_FIXED) {
    const fixed = promo.fixedPrice
    return fixed == null ? listPrice : fixed
  }
  const percent = promo.discountPercent
  if (percent == null) return listPrice
  return listPrice * (1 - percent / 100)
}

/**
 * Match item_price rows with AND across every scope field set on the promotion:
 * item, item_group, and price_group. Empty scope fields are ignored; at least one
 * must be set.
 */
export function promotionMatchesRow(
  promo: ActivePromotion,
  itemId: string | null,
  itemGroupId: string | null,
  priceGroupId: string | null,
): boolean {
  const hasItem = Boolean(promo.itemId)
  const hasItemGroup = Boolean(promo.itemGroupId)
  const hasPriceGroup = Boolean(promo.itemPriceGroupId)
  if (!hasItem && !hasItemGroup && !hasPriceGroup) return false

  if (hasItem && (!itemId || promo.itemId !== itemId)) return false
  if (hasItemGroup && (!itemGroupId || promo.itemGroupId !== itemGroupId)) {
    return false
  }
  if (
    hasPriceGroup &&
    (!priceGroupId || promo.itemPriceGroupId !== priceGroupId)
  ) {
    return false
  }
  return true
}

function promotionSpecificity(promo: ActivePromotion): number {
  return (
    (promo.itemId ? 4 : 0) +
    (promo.itemGroupId ? 2 : 0) +
    (promo.itemPriceGroupId ? 1 : 0)
  )
}

/** Prefer more specific scope (item + group + price_group), then latest date_start. */
export function pickWinningPromotion(matches: ActivePromotion[]): ActivePromotion | null {
  if (matches.length === 0) return null
  return [...matches].sort((a, b) => {
    const spec = promotionSpecificity(b) - promotionSpecificity(a)
    if (spec !== 0) return spec
    if (a.dateStart !== b.dateStart) return a.dateStart < b.dateStart ? 1 : -1
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })[0] ?? null
}

function parsePromotion(
  row: Record<string, unknown>,
  fields: PromoSyncFieldMap,
  today: string,
): ActivePromotion | null {
  const id = fkIdFromValue(row.id) ?? fkIdFromValue(row.record_id)
  if (!id) return null
  const dateStart = toDateString(readField(row, fields.dateStart))
  const dateEnd = toDateString(readField(row, fields.dateEnd))
  if (!dateStart || !dateEnd) return null
  if (dateStart > today || dateEnd < today) return null
  const promoType = normalizePromoType(readField(row, fields.promoType))
  if (!promoType) return null
  return {
    id,
    dateStart,
    dateEnd,
    itemId: readFkId(row, fields.item, 'item'),
    itemGroupId: readFkId(row, fields.itemGroup, 'item_group'),
    // Pack uses price_group; older seeds may still use item_price_group.
    itemPriceGroupId: readFkId(
      row,
      fields.itemPriceGroup,
      'price_group',
      'item_price_group',
    ),
    promoType,
    fixedPrice: toNumber(readField(row, fields.fixedPrice)),
    discountPercent: toNumber(readField(row, fields.discountPercent)),
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000
}

function sameId(a: string | null, b: string | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return String(a) === String(b)
}

function sameMoney(a: number | null, b: number): boolean {
  if (a == null) return false
  return Math.abs(a - b) < 1e-9
}

export async function syncPromoPrices(
  params: Record<string, unknown>,
  timeZone: string,
): Promise<Record<string, unknown>> {
  const resolved = resolvePromoSyncParams(params)
  const today = todayIso(timeZone)

  const [promotionMeta, itemPriceMeta, itemMeta] = await Promise.all([
    loadEntityMeta(resolved.promotionCollection),
    loadEntityMeta(resolved.itemPriceCollection),
    loadEntityMeta(resolved.itemCollection),
  ])

  if (!promotionMeta || !itemPriceMeta || !itemMeta) {
    return {
      today,
      skipped: true,
      reason: 'missing_entities',
      promotion: Boolean(promotionMeta),
      itemPrice: Boolean(itemPriceMeta),
      item: Boolean(itemMeta),
      updated: 0,
      cleared: 0,
      unchanged: 0,
      activePromotions: 0,
    }
  }

  const f = resolved.fields
  const promotionPriceGroupFields = Array.from(
    new Set(
      [f.itemPriceGroup, 'price_group', 'item_price_group'].filter(Boolean),
    ),
  )
  const itemPriceGroupFields = Array.from(
    new Set(
      [f.itemPriceGroupField, 'price_group', 'item_price_group'].filter(Boolean),
    ),
  )
  const [promotionsResult, itemsResult, pricesResult] = await Promise.all([
    findManyRecords(resolved.promotionCollection, {
      limit: -1,
      fields: [
        'id',
        f.dateStart,
        f.dateEnd,
        f.item,
        f.itemGroup,
        ...promotionPriceGroupFields,
        f.promoType,
        f.fixedPrice,
        f.discountPercent,
      ],
    }),
    findManyRecords(resolved.itemCollection, {
      limit: -1,
      fields: ['id', f.itemGroupField],
    }),
    findManyRecords(resolved.itemPriceCollection, {
      limit: -1,
      fields: [
        'id',
        f.itemPriceItem,
        ...itemPriceGroupFields,
        f.price,
        f.promoPrice,
        f.promotion,
      ],
    }),
  ])

  const activePromotions = promotionsResult.nodes
    .map((row) => parsePromotion(row, f, today))
    .filter((row): row is ActivePromotion => row != null)

  const itemGroupByItemId = new Map<string, string | null>()
  for (const row of itemsResult.nodes) {
    const id = fkIdFromValue(row.id)
    if (!id) continue
    itemGroupByItemId.set(
      id,
      readFkId(row, f.itemGroupField, 'group', 'item_group'),
    )
  }

  let updated = 0
  let cleared = 0
  let unchanged = 0

  for (const row of pricesResult.nodes) {
    const id = fkIdFromValue(row.id)
    if (!id) continue
    const itemId = readFkId(row, f.itemPriceItem, 'item')
    const priceGroupId = readFkId(row, ...itemPriceGroupFields)
    const itemGroupId = itemId ? (itemGroupByItemId.get(itemId) ?? null) : null
    const listPrice = toNumber(readField(row, f.price)) ?? 0
    const currentPromotionId = fkIdFromValue(readField(row, f.promotion))
    const currentPromoPrice = toNumber(readField(row, f.promoPrice))

    const matches = activePromotions.filter((promo) =>
      promotionMatchesRow(promo, itemId, itemGroupId, priceGroupId),
    )
    const winner = pickWinningPromotion(matches)

    // No winner or linked promo past date_end: clear promotion and restore list price.
    const nextPromotionId = winner ? winner.id : null
    const nextPromoPrice = roundMoney(
      winner ? computePromoPrice(listPrice, winner) : listPrice,
    )

    if (
      sameId(currentPromotionId, nextPromotionId) &&
      sameMoney(currentPromoPrice, nextPromoPrice)
    ) {
      unchanged += 1
      continue
    }

    const patch: Record<string, unknown> = {
      [f.promoPrice]: nextPromoPrice,
      [f.promotion]: nextPromotionId,
    }
    await updateRecord(resolved.itemPriceCollection, id, patch)

    if (!winner) {
      cleared += 1
    } else {
      updated += 1
    }
  }

  return {
    today,
    skipped: false,
    activePromotions: activePromotions.length,
    activeWithPriceGroup: activePromotions.filter((p) => p.itemPriceGroupId)
      .length,
    activeWithItemGroup: activePromotions.filter((p) => p.itemGroupId).length,
    activeWithItem: activePromotions.filter((p) => p.itemId).length,
    itemPrices: pricesResult.nodes.length,
    updated,
    cleared,
    unchanged,
  }
}
