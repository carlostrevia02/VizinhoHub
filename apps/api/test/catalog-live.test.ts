// Catálogo em tempo real: triggers da migração 015 → LISTEN/NOTIFY → namespace público /catalog (sem token).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { io as connect, type Socket } from 'socket.io-client'
import { CREME, ZE, startTestEnv, tokenFor, type TestEnv } from './helpers.js'

const MIGRATION = path.resolve(import.meta.dirname, '../../../db/migrations/015-catalogo-tempo-real.sql')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let t: TestEnv
const sockets: Socket[] = []

// Visitante anônimo: sem `auth`. Resolve já conectado ao namespace /catalog.
const anonymous = () =>
  new Promise<Socket>((resolve, reject) => {
    const s = connect(`${t.baseUrl}/catalog`, { transports: ['websocket'] })
    sockets.push(s)
    s.on('connect', () => resolve(s))
    s.on('connect_error', reject)
  })

const waitFor = (s: Socket, ms: number) =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    s.once('catalog:changed', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })

const setPrice = (price: number) => t.api('PUT', `/api/v1/products/${CREME}`, { token: tokenFor(ZE), body: { price } })

before(async () => {
  t = await startTestEnv()
  // O ambiente de teste só aplica schema.sql + seed.sql: a migração 015 (idempotente) cria os triggers. Duas vezes, para provar isso.
  const sql = fs.readFileSync(MIGRATION, 'utf8')
  await t.db.query(sql)
  await t.db.query(sql)
})

after(async () => {
  for (const s of sockets) s.close()
  await t?.stop()
})

describe('catálogo em tempo real (/catalog)', () => {
  it('visitante anônimo recebe catalog:changed quando um produto muda pela API', async () => {
    const visitor = await anonymous()
    const event = waitFor(visitor, 5000)
    const res = await setPrice(4.5)
    assert.equal(res.status, 200)
    assert.equal(await event, true)
  })

  it('INSERT direto de categoria também avisa', async () => {
    await sleep(2200) // deixa a janela de agrupamento do teste anterior fechar
    const visitor = await anonymous()
    const event = waitFor(visitor, 5000)
    await t.db.query(`INSERT INTO categories (name) VALUES ('Categoria ao vivo')`)
    assert.equal(await event, true)
  })

  it('o namespace padrão continua exigindo token', async () => {
    const s = connect(t.baseUrl, { transports: ['websocket'] })
    sockets.push(s)
    const err = await new Promise<Error>((resolve) => s.on('connect_error', resolve))
    assert.ok(err)
  })

  it('rajada de alterações vira poucas emissões (leading + trailing)', async () => {
    await sleep(4200) // janela + trailing dos testes anteriores totalmente encerrados
    const visitor = await anonymous()
    let emissions = 0
    visitor.on('catalog:changed', () => emissions++)
    for (let i = 0; i < 20; i++) await t.db.query('UPDATE products SET price = price WHERE id = $1', [CREME])
    await sleep(3500)
    assert.ok(emissions >= 1, 'a primeira alteração emite na hora')
    assert.ok(emissions <= 2, `20 alterações geraram ${emissions} emissões (esperado: 1 leading + 1 trailing)`)
  })
})
