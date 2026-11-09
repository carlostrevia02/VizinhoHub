// Roda uma varredura de Ofertas do Bairro agora (sem esperar o job horário): npm run scan-deals
import { createClaudeExtractor } from '../src/modules/deals/deals.extractor.js'
import { createPageFetcher } from '../src/modules/deals/deals.fetcher.js'
import { runDealsScan } from '../src/modules/deals/deals.scanner.js'
import { createPool } from '../src/shared/db.js'
import { loadEnv } from '../src/shared/env.js'

const env = loadEnv()
if (!env.ANTHROPIC_API_KEY) throw new Error('Defina ANTHROPIC_API_KEY no .env para varrer os supermercados.')

const db = createPool(env.DATABASE_URL)
try {
  const summary = await runDealsScan({
    db,
    fetchPage: createPageFetcher({ userAgent: env.DEALS_USER_AGENT }),
    extract: createClaudeExtractor({ apiKey: env.ANTHROPIC_API_KEY, model: env.DEALS_MODEL }),
    log: console.log,
  })
  console.log(summary)
} finally {
  await db.end()
}
