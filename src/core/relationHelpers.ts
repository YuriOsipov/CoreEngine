import type { RelationDefinition } from '@/interfaces'

export function keysEqual(left: string, right: string): boolean {
  return normalizeKey(left) === normalizeKey(right)
}

export function relationManyCollection(
  relation: RelationDefinition | undefined,
): string {
  return relation?.meta?.many_collection ?? relation?.collection ?? ''
}

export function relationField(relation: RelationDefinition): string {
  return relation.meta?.many_field ?? relation.field
}

export function relationRelatedCollection(
  relation: RelationDefinition | undefined,
): string {
  return relation?.related_collection ?? relation?.meta?.one_collection ?? ''
}

export function relatedCollectionForCollectionField(
  relations: RelationDefinition[],
  collection: string,
  field: string,
): string {
  if (!collection || !field) return ''

  const relation = relations.find((item) =>
    keysEqual(relationManyCollection(item), collection) &&
      keysEqual(relationField(item), field),
  )
  return relationRelatedCollection(relation)
}

export function relationForChildCollection(
  relations: RelationDefinition[],
  childCollection: string,
  relatedCollection: string,
): RelationDefinition | null {
  return relations.find((relation) =>
    keysEqual(relationManyCollection(relation), childCollection) &&
      keysEqual(relationRelatedCollection(relation), relatedCollection),
  ) ?? null
}

export function childCollectionHasRelationTo(
  relations: RelationDefinition[],
  childCollection: string,
  relatedCollection: string,
): boolean {
  return Boolean(relationForChildCollection(relations, childCollection, relatedCollection))
}

function normalizeKey(value: string): string {
  return value.replace(/[_\s-]/g, '').toLowerCase()
}
