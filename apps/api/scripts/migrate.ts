// Aplica as migrações de db/migrations em um banco que já existe (ex.: o do `npm run dev:db`).
// Todas são idempotentes (IF NOT EXISTS), exceto a 001 (tipos/tabelas das Ofertas do Bairro), que é pulada
// quando as tabelas já existem. Uso: npm run migrate
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { loadEnv } from '../src/shared/env.js'

const env = loadEnv()
const dir = path.resolve(import.meta.dirname, '../../../db/migrations')
const db = new pg.Client({ connectionString: env.DATABASE_URL })
await db.connect()

const { rows } = await db.query<{ exists: boolean }>(`SELECT to_regclass('public.retail_chains') IS NOT NULL AS exists`)
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (file.startsWith('001-') && rows[0]!.exists) {
    console.log(`= ${file} (já aplicada)`)
    continue
  }
  await db.query(fs.readFileSync(path.join(dir, file), 'utf8'))
  console.log(`✓ ${file}`)
}
await db.end()
