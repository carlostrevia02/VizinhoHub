// Migração 018 (filiais das redes): aplica em cima do schema atual de forma idempotente e as restrições da tabela
// chain_branches (faixa de latitude/longitude, origem, unicidade por rede + fonte + id externo) valem de verdade.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { startTestEnv, type TestEnv } from './helpers.js'

const MIGRATION = path.resolve(import.meta.dirname, '../../../db/migrations/018-filiais-das-redes.sql')

let t: TestEnv
let chainId: number
before(async () => {
  t = await startTestEnv()
  // Duas vezes: a segunda prova a idempotência (é o que `npm run migrate` faz em bancos já migrados).
  for (let i = 0; i < 2; i++) await t.db.query(fs.readFileSync(MIGRATION, 'utf8'))
  chainId = (await t.db.query(`SELECT id FROM retail_chains WHERE slug = 'sao-luiz'`)).rows[0].id
})
after(() => t?.stop())

const insert = (over: { lat?: number; lng?: number; source?: string; ref?: string | null; name?: string } = {}) =>
  t.db.query(
    `INSERT INTO chain_branches (chain_id, name, latitude, longitude, source, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [chainId, over.name ?? 'São Luiz Aldeota', over.lat ?? -3.7319, over.lng ?? -38.5267, over.source ?? 'OSM', over.ref === undefined ? 'node/123' : over.ref],
  )

describe('filiais das redes (migração 018)', () => {
  it('insere uma filial válida, com os padrões esperados', async () => {
    const { rows } = await insert({ ref: 'node/1' })
    assert.equal(rows[0].active, true)
    assert.equal(rows[0].source, 'OSM')
    assert.ok(rows[0].created_at)
  })

  it('o source padrão é MANUAL', async () => {
    const { rows } = await t.db.query(
      `INSERT INTO chain_branches (chain_id, name, latitude, longitude) VALUES ($1, 'São Luiz Centro', -3.72, -38.52) RETURNING source`,
      [chainId],
    )
    assert.equal(rows[0].source, 'MANUAL')
  })

  it('rejeita latitude 91 e longitude 181', async () => {
    await assert.rejects(insert({ lat: 91, ref: 'node/2' }), { code: '23514' })
    await assert.rejects(insert({ lng: 181, ref: 'node/3' }), { code: '23514' })
  })

  it('rejeita origem fora de OSM/GOOGLE/MANUAL', async () => {
    await assert.rejects(insert({ source: 'OUTRA', ref: 'node/4' }), { code: '23514' })
  })

  it('rejeita duplicata (chain_id, source, source_ref), mas aceita a mesma ref em outra fonte', async () => {
    await insert({ ref: 'node/10' })
    await assert.rejects(insert({ ref: 'node/10' }), { code: '23505' })
    await insert({ source: 'GOOGLE', ref: 'node/10' })
  })

  it('source_ref NULL não conta como duplicata (NULL é distinto no UNIQUE)', async () => {
    await insert({ source: 'MANUAL', ref: null })
    await insert({ source: 'MANUAL', ref: null })
  })

  it('os índices existem', async () => {
    const { rows } = await t.db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'chain_branches'`)
    const names = rows.map((r) => r.indexname)
    assert.ok(names.includes('idx_chain_branches_geo'))
    assert.ok(names.includes('idx_chain_branches_chain'))
  })
})
