export {
  aggregateRecords,
  clearRecordsBackendCache,
  createRecord,
  findManyRecords,
  findOneRecord,
  hardDeleteRecord,
  restoreRecord,
  resolveRecordsBackend,
  resolveRecordsStore,
  softDeleteRecord,
  updateRecord,
} from './records/facade.js'
export type { RecordsBackend } from './records/registry.js'
export type {
  RecordAccess,
  RecordsListParams,
  RecordsListResult,
  RecordsStore,
} from './records/types.js'
export { clearRecordRelationsCache } from './records/relations.js'
