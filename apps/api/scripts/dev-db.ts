// Postgres local de desenvolvimento SEM Docker (usa o mesmo binário dos testes).
//   npm run dev:db      → sobe em localhost:<porta do DATABASE_URL> e fica rodando (Ctrl+C para parar)
// Na 1ª vez cria o banco e aplica db/schema.sql + db/seed.sql. Os dados ficam em apps/api/.pgdata.
// Para recriar do zero: pare o processo e apague a pasta .pgdata.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { loadEnv } from '../src/shared/env.js'

const env = loadEnv()
if (env.NODE_ENV === 'production') throw new Error('dev-db não roda em produção.')

const url = new URL(env.DATABASE_URL)
const user = decodeURIComponent(url.username)
const password = decodeURIComponent(url.password)
const database = url.pathname.slice(1)
const port = Number(url.port || 5432)

const root = path.resolve(import.meta.dirname, '../../..')
const dir = path.resolve(import.meta.dirname, '../.pgdata')
const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'))

const server = new EmbeddedPostgres({ databaseDir: dir, user, password, port, persistent: true })
if (fresh) await server.initialise()
await server.start()

if (fresh) {
  // Banco UTF-8 independente da codificação padrão do Windows.
  const admin = new pg.Client({ connectionString: `postgresql://${user}:${password}@localhost:${port}/postgres` })
  await admin.connect()
  await admin.query(`CREATE DATABASE "${database}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`)
  await admin.end()

  const db = new pg.Client({ connectionString: env.DATABASE_URL })
  await db.connect()
  await db.query(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'))
  await db.query(fs.readFileSync(path.join(root, 'db/seed.sql'), 'utf8'))
  await db.end()
  console.log('Banco criado com schema + seed.')
}

console.log(`PostgreSQL pronto em localhost:${port}/${database}  (Ctrl+C para parar)`)

let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  // Parada limpa; se o Postgres embutido travar (comum no Windows), derruba a árvore de processos.
  const done = await Promise.race([server.stop().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 8000))])
  if (!done && process.platform === 'win32') {
    try {
      const pid = Number(fs.readFileSync(path.join(dir, 'postmaster.pid'), 'utf8').split('\n')[0])
      if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* já parou */
    }
  }
  process.exit(0)
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown())
setInterval(() => {}, 1 << 30) // mantém o processo vivo
