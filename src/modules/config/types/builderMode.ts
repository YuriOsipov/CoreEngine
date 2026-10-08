export type BuilderMode =
  | 'recordPage'
  | 'table'
  | 'entity'
  | 'entityCompact'
  | 'tree'
  | 'scheduler'
  | 'document'

export const BUILDER_MODES: BuilderMode[] = [
  'recordPage',
  'table',
  'entity',
  'entityCompact',
  'tree',
  'scheduler',
  'document',
]

export function isEntityBuilderMode(mode: BuilderMode): boolean {
  return mode === 'entity' || mode === 'entityCompact'
}
