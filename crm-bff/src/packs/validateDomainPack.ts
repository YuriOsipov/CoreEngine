/**
 * Structural validation for domain-pack JSON (no apply / no DDL).
 */

export type PackValidationIssue = {
  level: 'error' | 'warning'
  path: string
  message: string
}

export type PackValidationResult = {
  ok: boolean
  errors: PackValidationIssue[]
  warnings: PackValidationIssue[]
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function push(
  issues: PackValidationIssue[],
  level: 'error' | 'warning',
  path: string,
  message: string,
): void {
  issues.push({ level, path, message })
}

/**
 * Validate a pack payload (either full DomainPackExport shape or file-style
 * `{ pack, entities: { entities }, roles: { roles }, … }`).
 */
export function validateDomainPack(input: unknown): PackValidationResult {
  const errors: PackValidationIssue[] = []
  const warnings: PackValidationIssue[] = []
  const root = asObject(input)
  if (!root) {
    return {
      ok: false,
      errors: [
        {
          level: 'error',
          path: '',
          message: 'Pack must be a JSON object',
        },
      ],
      warnings: [],
    }
  }

  const pack = asObject(root.pack) ?? root
  const packId = String(pack.id ?? '').trim()
  if (!packId || !/^[a-z][a-z0-9_]*$/.test(packId)) {
    push(
      errors,
      'error',
      'pack.id',
      'pack.id must be lowercase snake_case (e.g. sales)',
    )
  }
  if (!String(pack.label ?? '').trim()) {
    push(warnings, 'warning', 'pack.label', 'pack.label is empty')
  }

  const entitiesContainer = asObject(root.entities)
  const entities = Array.isArray(root.entities)
    ? root.entities
    : Array.isArray(entitiesContainer?.entities)
      ? entitiesContainer.entities
      : null
  if (!entities) {
    push(errors, 'error', 'entities', 'entities array is required')
  } else {
    const names = new Set<string>()
    entities.forEach((raw, index) => {
      const entity = asObject(raw)
      const path = `entities[${index}]`
      if (!entity) {
        push(errors, 'error', path, 'entity must be an object')
        return
      }
      const apiName = String(entity.apiName ?? '').trim()
      if (!apiName || !/^[a-z][a-z0-9_]*$/.test(apiName)) {
        push(
          errors,
          'error',
          `${path}.apiName`,
          'apiName must be lowercase snake_case',
        )
      } else if (names.has(apiName)) {
        push(errors, 'error', `${path}.apiName`, `duplicate apiName ${apiName}`)
      } else {
        names.add(apiName)
      }
      if (!String(entity.label ?? '').trim()) {
        push(warnings, 'warning', `${path}.label`, 'label is empty')
      }
      const fields = Array.isArray(entity.fields) ? entity.fields : null
      if (!fields) {
        push(warnings, 'warning', `${path}.fields`, 'fields array missing')
        return
      }
      const fieldNames = new Set<string>()
      fields.forEach((fieldRaw, fi) => {
        const field = asObject(fieldRaw)
        const fpath = `${path}.fields[${fi}]`
        if (!field) {
          push(errors, 'error', fpath, 'field must be an object')
          return
        }
        const fieldApi = String(field.apiName ?? '').trim()
        if (!fieldApi || !/^[a-z][a-z0-9_]*$/.test(fieldApi)) {
          push(
            errors,
            'error',
            `${fpath}.apiName`,
            'field apiName must be lowercase snake_case',
          )
        } else if (fieldNames.has(fieldApi)) {
          push(
            errors,
            'error',
            `${fpath}.apiName`,
            `duplicate field ${fieldApi}`,
          )
        } else {
          fieldNames.add(fieldApi)
        }
        if (field.sensitivity != null) {
          const s = Number(field.sensitivity)
          if (![0, 1, 2].includes(s)) {
            push(
              errors,
              'error',
              `${fpath}.sensitivity`,
              'sensitivity must be 0, 1, or 2',
            )
          }
        }
        const relationKind =
          field.relationKind != null
            ? String(field.relationKind).toUpperCase()
            : ''
        if (relationKind && !field.relatedEntity) {
          push(
            warnings,
            'warning',
            `${fpath}.relatedEntity`,
            `relation ${relationKind} without relatedEntity`,
          )
        }
      })
    })

    const layoutsContainer = asObject(root.layouts)
    const layouts = Array.isArray(root.layouts)
      ? root.layouts
      : Array.isArray(layoutsContainer?.layouts)
        ? layoutsContainer.layouts
        : []
    for (let i = 0; i < layouts.length; i++) {
      const layout = asObject(layouts[i])
      const path = `layouts[${i}]`
      if (!layout) {
        push(errors, 'error', path, 'layout must be an object')
        continue
      }
      const entityApiName = String(layout.entityApiName ?? '').trim()
      if (entityApiName && !names.has(entityApiName) && entityApiName !== 'crm_navigation') {
        // Platform overlays may appear; warn only.
        push(
          warnings,
          'warning',
          `${path}.entityApiName`,
          `layout references entity "${entityApiName}" not in entities list`,
        )
      }
      if (!String(layout.groupKey ?? '').trim()) {
        push(errors, 'error', `${path}.groupKey`, 'groupKey is required')
      }
    }

    const rolesContainer = asObject(root.roles)
    const roles = Array.isArray(root.roles)
      ? root.roles
      : Array.isArray(rolesContainer?.roles)
        ? rolesContainer.roles
        : []
    for (let i = 0; i < roles.length; i++) {
      const role = asObject(roles[i])
      const path = `roles[${i}]`
      if (!role) {
        push(errors, 'error', path, 'role must be an object')
        continue
      }
      if (!String(role.name ?? '').trim()) {
        push(errors, 'error', `${path}.name`, 'role name is required')
      }
      for (const key of ['canViewAllOn', 'canModifyAllOn'] as const) {
        const list = role[key]
        if (list == null) continue
        if (!Array.isArray(list)) {
          push(errors, 'error', `${path}.${key}`, `${key} must be an array`)
          continue
        }
        for (const ent of list) {
          const name = String(ent)
          if (names.size && !names.has(name)) {
            push(
              warnings,
              'warning',
              `${path}.${key}`,
              `references entity "${name}" not in entities list`,
            )
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}
