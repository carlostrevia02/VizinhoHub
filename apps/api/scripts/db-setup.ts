// Prepara o banco de homologação/produção. Seguro para rodar a cada deploy (preDeployCommand):
//   1. se o schema ainda não existe (banco vazio), aplica db/schema.sql;
//   2. roda as migrações idempotentes de db/migrations;
//   3. fixa o fuso do banco em America/Fortaleza (o Salva-Estoque compara expiration_date com current_date).
// NUNCA carrega db/seed.sql: a API se recusa a subir em produção se houver contas @vizinhohub.test.
// Lê DATABASE_URL do ambiente (não exige arquivo .env). Uso: npm run db:setup
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { applyMigrations } from './migrations.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL não definido.')

const db = new pg.Client({ connectionString: url })
await db.connect()
try {
  const { rows } = await db.query<{ exists: boolean }>(`SELECT to_regclass('public.users') IS NOT NULL AS exists`)
  if (rows[0]!.exists) {
    console.log('= schema.sql (já aplicado)')
  } else {
    await db.query(fs.readFileSync(path.resolve(import.meta.dirname, '../../../db/schema.sql'), 'utf8'))
    console.log('✓ schema.sql')
  }
  await applyMigrations(db)
  try {
    await db.query(`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Fortaleza'); END $$`)
    console.log('✓ timezone do banco = America/Fortaleza')
  } catch (e) {
    console.warn(`Aviso: não foi possível fixar o fuso do banco (${(e as Error).message}). Configure timezone=America/Fortaleza no provedor.`)
  }
} finally {
  await db.end()
}
