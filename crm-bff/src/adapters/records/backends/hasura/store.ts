import type { RecordsStore } from '../../types.js'
import {
  clearHasuraRecordsCache,
  hasuraAggregate,
  hasuraCreate,
  hasuraFindMany,
  hasuraFindOne,
  hasuraHardDelete,
  hasuraRestore,
  hasuraSoftDelete,
  hasuraUpdate,
} from './records.js'

export const hasuraRecordsStore: RecordsStore = {
  id: 'HASURA',
  findMany: hasuraFindMany,
  findOne: hasuraFindOne,
  create: hasuraCreate,
  update: hasuraUpdate,
  softDelete: hasuraSoftDelete,
  restore: hasuraRestore,
  hardDelete: hasuraHardDelete,
  aggregate: hasuraAggregate,
  clearCache: clearHasuraRecordsCache,
}
