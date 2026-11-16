import { buildServer } from './app.js'
import { createClaudeExtractor } from './modules/deals/deals.extractor.js'
import { createPageFetcher } from './modules/deals/deals.fetcher.js'
import { runDealsScan } from './modules/deals/deals.scanner.js'
import { createPool } from './shared/db.js'
import { loadEnv } from './shared/env.js'
import { startClearanceJob, startDealsScanJob, startFlashExpiryJob } from './shared/jobs.js'

const env = loadEnv()
const db = createPool(env.DATABASE_URL)

// Contas do seed (senha pública "vizinho123") nunca podem existir em produção.
if (env.NODE_ENV === 'production') {
  const { rows } = await db.query(`SELECT email::text FROM users WHERE email LIKE '%@vizinhohub.test'`)
  if (rows.length) {
    throw new Error(`Há contas de desenvolvimento no banco de produção (${rows.map((r) => r.email).join(', ')}). Remova-as antes de subir a API.`)
  }
}
const { httpServer, io, flyers, flash } = buildServer(env, db)
const stopClearanceJob = startClearanceJob(db)
const stopFlashJob = startFlashExpiryJob(() => flash.expireStale())

// Ofertas do Bairro: só liga com a chave do Claude.
let stopDealsJob = () => {}
if (env.ANTHROPIC_API_KEY) {
  const extract = createClaudeExtractor({ apiKey: env.ANTHROPIC_API_KEY, model: env.DEALS_MODEL })
  const fetchPage = createPageFetcher({ userAgent: env.DEALS_USER_AGENT })
  stopDealsJob = startDealsScanJob(
    () => runDealsScan({ db, fetchPage, extract, log: (m) => console.log(`Ofertas do Bairro · ${m}`) }),
    env.DEALS_SCAN_INTERVAL_MIN * 60_000,
  )
}

httpServer.listen(env.API_PORT, () => {
  console.log(`VizinhoHub API em http://localhost:${env.API_PORT} (HTTP + WebSocket) · base /api/v1`)
  if (!env.ANTHROPIC_API_KEY) console.log('Aviso: ANTHROPIC_API_KEY não definido — o job de Ofertas do Bairro está desligado.')
  if (!env.FIREBASE_PROJECT_ID) console.log('Aviso: FIREBASE_PROJECT_ID não definido — POST /auth/firebase responde 501.')
})

// Encerramento limpo: para de aceitar conexões, fecha sockets e o pool do banco.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopClearanceJob()
    stopFlashJob()
    stopDealsJob()
    io.close()
    // Termina as leituras de encarte em andamento antes de fechar o banco.
    httpServer.close(() => void flyers.idle().then(() => db.end()).then(() => process.exit(0)))
  })
}
