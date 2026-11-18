import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createApiClient } from './api-client.js'
import { loadConfig } from './config.js'
import { createServer } from './server.js'

// ATENÇÃO: em stdio o stdout é o canal do protocolo MCP. NUNCA use console.log aqui; logs só em stderr.
async function main() {
  const config = loadConfig()
  const server = createServer(createApiClient(config))
  await server.connect(new StdioServerTransport())
  console.error(`[vizinhohub-mcp] pronto (API: ${config.apiUrl})`)
}

main().catch((err) => {
  console.error(`[vizinhohub-mcp] falha ao iniciar: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
