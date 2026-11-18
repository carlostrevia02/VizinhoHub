// Lógica compartilhada de migrações (usada por migrate.ts e db-setup.ts).
// Todas as migrações de db/migrations são idempotentes (IF NOT EXISTS), exceto a 001 (tipos/tabelas das Ofertas do Bairro),
// que é pulada quando as tabelas já existem.
import fs from 'node:fs'
import path from 'node:path'
import type pg from 'pg'

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../db/migrations')

export async function applyMigrations(db: pg.Client, log: (msg: string) => void = console.log) {
  const { rows } = await db.query<{ exists: boolean }>(`SELECT to_regclass('public.retail_chains') IS NOT NULL AS exists`)
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (file.startsWith('001-') && rows[0]!.exists) {
      log(`= ${file} (já aplicada)`)
      continue
    }
    await db.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
    log(`✓ ${file}`)
  }
}
