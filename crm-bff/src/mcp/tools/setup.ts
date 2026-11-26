import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { AuthContext } from '../../auth/accessGuards.js'
import { recordConfigAudit } from '../../audit/configAuditService.js'
import { query } from '../../db/pool.js'
import { updateEntityMeta } from '../../schema/entityMeta.js'
import { createRegistryEntity } from '../../schema/entityRegistry.js'
import {
  createRegistryField,
  updateRegistryField,
  type RegistryFieldInput,
} from '../../schema/fieldRegistry.js'
import { upsertLayoutSettingRow } from '../../schema/layoutSettings.js'
import { assertToolAccess } from '../auth.js'
import { errorToolResult, jsonToolResult } from '../result.js'

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function registerSetupTools(
  server: McpServer,
  ctx: AuthContext,
): void {
  server.registerTool(
    'list_objects',
    {
      title: 'List objects',
      description:
        'List CoreEngine business objects (apiName, label, group, relations summary).',
      inputSchema: {
        includeHidden: z
          .boolean()
          .optional()
          .describe('Include hidden objects (default false)'),
      },
    },
    async (args) => {
      try {
        await assertToolAccess(ctx, 'list_objects')
        const includeHidden = Boolean(args.includeHidden)
        const rows = await query<{
          api_name: string
          label: string
          entity_group: string | null
          hidden: boolean
          display_template: string | null
          icon: string | null
          backend_target: string
        }>(
          `SELECT api_name, label, entity_group, hidden, display_template, icon,
                  backend_target
           FROM public.entities
           WHERE deleted_at IS NULL
             AND ($1::boolean OR hidden = false)
             AND upper(COALESCE(backend_target, '')) <> 'PLATFORM'
             AND COALESCE((backend_config->>'internal')::boolean, false) = false
           ORDER BY api_name`,
          [includeHidden],
        )
        const relationCounts = await query<{
          entity_api_name: string
          count: string
        }>(
          `SELECT e.api_name AS entity_api_name, count(r.id)::text AS count
           FROM public.entities e
           LEFT JOIN public.relations r ON r.entity_id = e.id
           WHERE e.deleted_at IS NULL
           GROUP BY e.api_name`,
        )
        const countBy = new Map(
          relationCounts.map((r) => [r.entity_api_name, Number(r.count)]),
        )
        return jsonToolResult({
          objects: rows.map((row) => ({
            apiName: row.api_name,
            label: row.label,
            group: row.entity_group,
            hidden: row.hidden,
            displayTemplate: row.display_template,
            icon: row.icon,
            relationCount: countBy.get(row.api_name) ?? 0,
          })),
        })
      } catch (error) {
        return errorToolResult(error)
      }
    },
  )

  server.registerTool(
    'inspect_schema',
    {
      title: 'Inspect schema',
      description:
        'Inspect one object: fields, types, relations, sensitivity, and role layouts.',
      inputSchema: {
        apiName: z.string().describe('Object apiName (e.g. account)'),
      },
    },
    async (args) => {
      try {
        await assertToolAccess(ctx, 'inspect_schema')
        const apiName = String(args.apiName || '').trim()
        const entities = await query<{
          id: string
          api_name: string
          label: string
          display_template: string | null
          backend_config: unknown
          hidden: boolean
          icon: string | null
          entity_group: string | null
        }>(
          `SELECT id::text AS id, api_name, label, display_template, backend_config,
                  hidden, icon, entity_group
           FROM public.entities
           WHERE api_name = $1 AND deleted_at IS NULL
           LIMIT 1`,
          [apiName],
        )
        const entity = entities[0]
        if (!entity) throw new Error(`Entity not found: ${apiName}`)

        const fields = await query<{
          api_name: string
          label: string
          field_type: string
          interface: string | null
          required: boolean
          readonly: boolean
          hidden: boolean
          sensitivity: number
          is_unique: boolean
          is_indexed: boolean
          relation_kind: string | null
          related_api_name: string | null
          junction_api_name: string | null
          options: unknown
          display_options: unknown
        }>(
          `SELECT f.api_name, f.label, f.field_type, f.interface, f.required, f.readonly,
                  f.hidden, COALESCE(f.sensitivity, 0) AS sensitivity, f.is_unique, f.is_indexed,
                  r.kind AS relation_kind, related.api_name AS related_api_name,
                  junction.api_name AS junction_api_name, f.options, f.display_options
           FROM public.fields f
           LEFT JOIN public.relations r ON r.field_id = f.id
           LEFT JOIN public.entities related ON related.id = r.related_entity_id
           LEFT JOIN public.entities junction ON junction.id = r.junction_entity_id
           WHERE f.entity_id = $1::uuid
           ORDER BY f.sort ASC, f.api_name ASC`,
          [entity.id],
        )

        const layoutRows = await query<{
          id: string
          group_key: string
          sub_group: string | null
          role_id: string | null
          payload: unknown
        }>(
          `SELECT id::text AS id, group_key, sub_group, role_id, payload
           FROM public.layout_settings
           WHERE entity_api_name = $1
           ORDER BY group_key, COALESCE(sub_group, ''), COALESCE(role_id, ''), id`,
          [apiName],
        )

        return jsonToolResult({
          object: {
            apiName: entity.api_name,
            label: entity.label,
            displayTemplate: entity.display_template,
            backendConfig: asObject(entity.backend_config),
            hidden: entity.hidden,
            icon: entity.icon,
            group: entity.entity_group,
          },
          fields: fields.map((f) => ({
            apiName: f.api_name,
            label: f.label,
            type: f.field_type,
            interface: f.interface,
            required: f.required,
            readonly: f.readonly,
            hidden: f.hidden,
            sensitivity: f.sensitivity,
            isUnique: f.is_unique,
            isIndexed: f.is_indexed,
            relationKind: f.relation_kind,
            relatedEntity: f.related_api_name,
            junctionEntity: f.junction_api_name,
            options: asObject(f.options),
            displayOptions: asObject(f.display_options),
          })),
          layouts: layoutRows.map((row) => {
            const payload = asObject(row.payload)
            const meta = asObject(payload.__meta)
            return {
              id: row.id,
              settingId: String(meta.settingId ?? row.id),
              groupKey: row.group_key,
              subGroup: row.sub_group,
              roleId: row.role_id,
              name:
                (typeof payload.name === 'string' && payload.name) ||
                (typeof meta.name === 'string' && meta.name) ||
                null,
            }
          }),
        })
      } catch (error) {
        return errorToolResult(error)
      }
    },
  )

  server.registerTool(
    'upsert_object_schema',
    {
      title: 'Upsert object schema',
      description:
        'Create an object and/or upsert fields (including PII sensitivity 0–2). Applies DDL.',
      inputSchema: {
        apiName: z.string().describe('Object apiName'),
        label: z.string().optional().describe('Object label (create / rename)'),
        displayTemplate: z.string().optional(),
        icon: z.string().optional(),
        note: z.string().optional(),
        createIfMissing: z
          .boolean()
          .optional()
          .describe('Create the object when missing (default true)'),
        fields: z
          .array(
            z.object({
              apiName: z.string(),
              label: z.string(),
              type: z.string().optional(),
              interface: z.string().optional(),
              required: z.boolean().optional(),
              readonly: z.boolean().optional(),
              hidden: z.boolean().optional(),
              sensitivity: z.number().int().min(0).max(2).optional(),
              isUnique: z.boolean().optional(),
              isIndexed: z.boolean().optional(),
              options: z.record(z.string(), z.unknown()).optional(),
              displayOptions: z.record(z.string(), z.unknown()).optional(),
              relationKind: z.string().optional(),
              relatedEntity: z.string().optional(),
              junctionEntity: z.string().optional(),
              updateExisting: z
                .boolean()
                .optional()
                .describe('Update field when it already exists (default true)'),
            }),
          )
          .optional(),
      },
    },
    async (args) => {
      try {
        const me = await assertToolAccess(ctx, 'upsert_object_schema')
        const apiName = String(args.apiName || '').trim()
        const createIfMissing = args.createIfMissing !== false

        const existing = await query<{ api_name: string }>(
          `SELECT api_name FROM public.entities
           WHERE api_name = $1 AND deleted_at IS NULL LIMIT 1`,
          [apiName],
        )

        let createdEntity = false
        if (!existing[0]) {
          if (!createIfMissing) {
            throw new Error(`Entity not found: ${apiName}`)
          }
          const created = await createRegistryEntity({
            apiName,
            label: args.label || apiName,
            icon: args.icon,
            note: args.note,
          })
          createdEntity = true
          await recordConfigAudit(me, {
            action: 'CREATE',
            resourceType: 'entity',
            resourceKey: created.apiName,
            summary: `MCP create entity ${created.apiName}`,
            after: { apiName: created.apiName, label: created.label },
          })
        } else if (
          args.label != null ||
          args.displayTemplate != null ||
          args.icon != null ||
          args.note != null
        ) {
          const patch = {
            label: args.label,
            displayTemplate: args.displayTemplate,
            icon: args.icon,
            note: args.note,
          }
          await updateEntityMeta(apiName, patch)
          await recordConfigAudit(me, {
            action: 'UPDATE',
            resourceType: 'entity',
            resourceKey: apiName,
            summary: `MCP update entity meta ${apiName}`,
            after: {
              label: args.label ?? null,
              displayTemplate: args.displayTemplate ?? null,
              icon: args.icon ?? null,
              note: args.note ?? null,
            },
          })
        }

        const fieldResults: Array<Record<string, unknown>> = []
        for (const field of args.fields ?? []) {
          const fieldApi = String(field.apiName || '').trim()
          const existingField = await query<{ id: string; api_name: string }>(
            `SELECT f.id::text AS id, f.api_name
             FROM public.fields f
             JOIN public.entities e ON e.id = f.entity_id
             WHERE e.api_name = $1 AND f.api_name = $2
             LIMIT 1`,
            [apiName, fieldApi],
          )
          const input: RegistryFieldInput = {
            apiName: fieldApi,
            label: field.label,
            type: field.type || 'STRING',
            interface: field.interface || 'input',
            required: field.required,
            readonly: field.readonly,
            hidden: field.hidden,
            sensitivity: field.sensitivity,
            isUnique: field.isUnique,
            isIndexed: field.isIndexed,
            options: field.options ?? null,
            displayOptions: field.displayOptions ?? null,
            relationKind: field.relationKind,
            relatedEntity: field.relatedEntity,
            junctionEntity: field.junctionEntity,
          }

          if (existingField[0]) {
            if (field.updateExisting === false) {
              fieldResults.push({
                apiName: fieldApi,
                skipped: true,
                reason: 'exists',
              })
              continue
            }
            const updated = await updateRegistryField(
              existingField[0].id,
              input,
              { entityApiName: apiName },
            )
            await recordConfigAudit(me, {
              action: 'UPDATE',
              resourceType: 'field',
              resourceKey: `${apiName}.${fieldApi}`,
              summary: `MCP update field ${apiName}.${fieldApi}`,
              after: {
                apiName: updated.apiName,
                sensitivity: updated.sensitivity,
              },
            })
            fieldResults.push({
              apiName: updated.apiName,
              action: 'updated',
              sensitivity: updated.sensitivity,
            })
          } else {
            const created = await createRegistryField(apiName, input)
            await recordConfigAudit(me, {
              action: 'CREATE',
              resourceType: 'field',
              resourceKey: `${apiName}.${fieldApi}`,
              summary: `MCP create field ${apiName}.${fieldApi}`,
              after: {
                apiName: created.apiName,
                sensitivity: created.sensitivity,
              },
            })
            fieldResults.push({
              apiName: created.apiName,
              action: 'created',
              sensitivity: created.sensitivity,
            })
          }
        }

        return jsonToolResult({
          apiName,
          createdEntity,
          fields: fieldResults,
        })
      } catch (error) {
        return errorToolResult(error)
      }
    },
  )

  server.registerTool(
    'update_role_layout',
    {
      title: 'Update role layout',
      description:
        'Upsert a role-scoped layout (Block / Record / list) via layout_settings.',
      inputSchema: {
        entityApiName: z.string(),
        groupKey: z.string().describe('e.g. block, record, list, app'),
        subGroup: z.string().optional(),
        roleId: z.string().optional().describe('Role UUID; omit for global'),
        settingId: z.string().optional(),
        name: z.string().optional(),
        body: z
          .record(z.string(), z.unknown())
          .describe('Layout payload body (tabs/sections/fields JSON)'),
      },
    },
    async (args) => {
      try {
        const me = await assertToolAccess(ctx, 'update_role_layout')
        const saved = await upsertLayoutSettingRow({
          settingId: args.settingId,
          entityApiName: String(args.entityApiName).trim(),
          groupKey: String(args.groupKey).trim(),
          subGroup: args.subGroup ?? null,
          roleId: args.roleId ?? null,
          name: args.name ?? null,
          body: asObject(args.body),
        })
        const settingId = String(
          asObject(saved.payload).__meta &&
            asObject(asObject(saved.payload).__meta).settingId
            ? asObject(asObject(saved.payload).__meta).settingId
            : saved.id,
        )
        await recordConfigAudit(me, {
          action: 'UPDATE',
          resourceType: 'layout',
          resourceKey: settingId,
          summary: `MCP upsert layout ${saved.entityApiName}/${saved.groupKey}`,
          after: {
            entityApiName: saved.entityApiName,
            groupKey: saved.groupKey,
            roleId: saved.roleId,
            settingId,
          },
        })
        return jsonToolResult({ ...saved, settingId })
      } catch (error) {
        return errorToolResult(error)
      }
    },
  )
}
