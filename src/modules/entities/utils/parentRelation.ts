import type { RelationDefinition } from '@/interfaces'

/** Child collection name for a relation (many side). */
export function relationCollectionName(relation: RelationDefinition): string {
  return relation.meta?.many_collection || relation.collection
}

/**
 * Score how well a relation matches a layout binding key
 * (`one_field`, FK field, or `{collection}_{fk}` like `message_user_created`).
 */
export function relationMatchScore(
  relation: RelationDefinition,
  relatedCollection: string,
  relatedField: string,
): number {
  if (!relatedField) return 0
  if (relation.meta?.one_field === relatedField) return 4
  if (relation.field === relatedField || relation.meta?.many_field === relatedField) {
    return 3
  }
  if (`${relatedCollection}_${relation.field}` === relatedField) return 2
  if (`${relationCollectionName(relation)}_${relation.field}` === relatedField) {
    return 1
  }
  return 0
}

/** Pick the best child→parent relation for a binding key (or first match). */
export function bestParentRelation(
  relations: RelationDefinition[],
  childCollection: string,
  parentCollection: string,
  bindingKey?: string | null,
): RelationDefinition | undefined {
  const candidates = relations.filter(
    (relation) =>
      relationCollectionName(relation) === childCollection &&
      (relation.related_collection === parentCollection ||
        relation.meta?.one_collection === parentCollection),
  )
  if (!candidates.length) return undefined

  const key = bindingKey?.trim()
  if (!key) return candidates[0]

  return [...candidates].sort(
    (left, right) =>
      relationMatchScore(right, childCollection, key) -
      relationMatchScore(left, childCollection, key),
  )[0]
}

/** FK field name on the child used to link to the parent. */
export function parentFkFromRelation(
  relation: RelationDefinition | undefined,
): string | null {
  if (!relation) return null
  return relation.meta?.many_field || relation.field || null
}
