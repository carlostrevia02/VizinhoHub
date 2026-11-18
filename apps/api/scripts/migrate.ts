// Aplica as migrações de db/migrations em um banco que já existe (ex.: o do `npm run dev:db`).
// Idempotente. Uso: npm run migrate
import pg from 'pg'
import { loadEnv } from '../src/shared/env.js'
import { applyMigrations } from './migrations.js'

const env = loadEnv()
const db = new pg.Client({ connectionString: env.DATABASE_URL })
await db.connect()
await applyMigrations(db)
await db.end()
