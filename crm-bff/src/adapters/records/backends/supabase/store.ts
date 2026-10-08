import type { RecordsStore } from '../../types.js'
import {
  postgresAggregate,
  postgresCreate,
  postgresFindMany,
  postgresFindOne,
  postgresHardDelete,
  postgresRestore,
  postgresSoftDelete,
  postgresUpdate,
} from './records.js'

export const supabaseRecordsStore: RecordsStore = {
  id: 'SUPABASE',
  findMany: postgresFindMany,
  findOne: postgresFindOne,
  create: postgresCreate,
  update: postgresUpdate,
  softDelete: postgresSoftDelete,
  restore: postgresRestore,
  hardDelete: postgresHardDelete,
  aggregate: postgresAggregate,
}
