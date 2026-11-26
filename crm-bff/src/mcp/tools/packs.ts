import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { AuthContext } from '../../auth/accessGuards.js'
import { exportDomainPack } from '../../packs/exportDomainPack.js'
import { validateDomainPack } from '../../packs/validateDomainPack.js'
import { assertToolAccess } from '../auth.js'
import { errorToolResult, jsonToolResult } from '../result.js'

export function registerPackTools(
  server: McpServer,
  ctx: AuthContext,
): void {
  server.registerTool(
    'export_domain_pack',
    {
      title: 'Export domain pack',
      description:
        'Export live Setup (entities, roles, layouts, nav) as pack-shaped JSON for Git. Does not write files.',
      inputSchema: {
        packId: z
          .string()
          .describe('Pack id (lowercase snake_case, e.g. sales)'),
        includeRecords: z
          .boolean()
          .optional()
          .describe('Include crm_schema record snapshots (default false)'),
        includeDashboards: z
          .boolean()
          .optional()
          .describe('Include dashboards/panels (default true)'),
        label: z.string().optional(),
        description: z.string().optional(),
      },
    },
    async (args) => {
      try {
        await assertToolAccess(ctx, 'export_domain_pack')
        const exported = await exportDomainPack({
          packId: String(args.packId).trim(),
          includeRecords: Boolean(args.includeRecords),
          includeDashboards: args.includeDashboards !== false,
          manifest: {
            label: args.label,
            description: args.description,
          },
        })
        return jsonToolResult({
          pack: exported.pack,
          entities: exported.entities,
          platformEntities: exported.platformEntities,
          layouts: exported.layouts,
          roles: exported.roles,
          recordsByEntity: exported.recordsByEntity,
          dashboards: exported.dashboards,
          panels: exported.panels,
          navigationApps: exported.navigationApps,
          meta: exported.meta,
          note: 'Commit under supabase/domains/<packId>/ via platform:export-pack or by saving these JSON files.',
        })
      } catch (error) {
        return errorToolResult(error)
      }
    },
  )

  server.registerTool(
    'validate_domain_pack',
    {
      title: 'Validate domain pack',
      description:
        'Validate pack JSON shape (entities, fields, layouts, roles). Does not apply the pack.',
      inputSchema: {
        pack: z
          .record(z.string(), z.unknown())
          .describe('Pack object (export_domain_pack output or file-style JSON)'),
      },
    },
    async (args) => {
      try {
        await assertToolAccess(ctx, 'validate_domain_pack')
        const result = validateDomainPack(args.pack)
        return jsonToolResult(result)
      } catch (error) {
        return errorToolResult(error)
      }
    },
  )
}
