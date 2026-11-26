import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthContext } from '../auth/accessGuards.js'
import { registerFlowTools } from './tools/flows.js'
import { registerPackTools } from './tools/packs.js'
import { registerRecordTools } from './tools/records.js'
import { registerSetupTools } from './tools/setup.js'

export function createCoreEngineMcpServer(ctx: AuthContext): McpServer {
  const server = new McpServer({
    name: 'coreengine',
    version: '0.1.0',
  })
  registerSetupTools(server, ctx)
  registerPackTools(server, ctx)
  registerRecordTools(server, ctx)
  registerFlowTools(server, ctx)
  return server
}
