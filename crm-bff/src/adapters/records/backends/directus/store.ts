import type { RecordsStore } from '../../types.js'
import {
  clearDirectusRecordsCache,
  directusAggregate,
  directusCreate,
  directusFindMany,
  directusFindOne,
  directusHardDelete,
  directusRestore,
  directusSoftDelete,
  directusUpdate,
} from './records.js'

export const directusRecordsStore: RecordsStore = {
  id: 'DIRECTUS',
  findMany: directusFindMany,
  findOne: directusFindOne,
  create: directusCreate,
  update: directusUpdate,
  softDelete: directusSoftDelete,
  restore: directusRestore,
  hardDelete: directusHardDelete,
  aggregate: directusAggregate,
  clearCache: clearDirectusRecordsCache,
}
