// Teste de integração: Postgres de verdade (embutido) + HTTP + Socket.io.
// Aplica db/schema.sql e db/seed.sql num banco descartável a cada execução.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { io as connect } from 'socket.io-client'
import type { OrderDTO } from '../src/modules/orders/orders.types.js'
import { CREME, IOGURTE, LUCIA, MARIA, SUCO_LUCIA, ZE, nextEvent as nextEventOf, startTestEnv, tokenFor, type TestEnv } from './helpers.js'

let t: TestEnv

const post = (body: unknown, token = tokenFor(MARIA)) =>
  fetch(`${t.baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

const socketFor = (userId: string) => t.socketFor(userId)
const nextEvent = (s: Parameters<typeof nextEventOf>[0], ms = 2000) => nextEventOf<OrderDTO>(s, 'order:created', ms)

before(async () => {
  t = await startTestEnv(54330)
})

after(() => t?.stop())

describe('POST /api/orders', () => {
  it('cria o pedido com preço do banco e avisa só o mercadinho dono via WebSocket', async () => {
    const ze = await socketFor(ZE)
    const lucia = await socketFor(LUCIA)
    const zeEvent = nextEvent(ze)
    const luciaEvent = nextEvent(lucia, 800)

    const res = await post({ items: [{ productId: CREME, quantity: 2 }, { productId: IOGURTE, quantity: 1 }, { productId: CREME, quantity: 1 }] })
    assert.equal(res.status, 201)
    const order = (await res.json()) as OrderDTO

    assert.equal(order.status, 'PENDING')
    assert.equal(order.merchantId, ZE)
    assert.equal(order.customer?.name, 'Maria Souza')
    // 3 × 4,29 (itens repetidos somados) + 1 × 2,72 (30% OFF) = 15,59
    assert.equal(order.totalPrice, 15.59)
    assert.deepEqual(order.items.map((i) => [i.name, i.quantity, i.unitPrice]), [
      ['Creme de Leite Nestlé 200g', 3, 4.29],
      ['Iogurte Molico Morango 170g', 1, 2.72],
    ])

    const received = await zeEvent
    assert.ok(received, 'o Zé deveria receber order:created')
    assert.equal(received.id, order.id)
    assert.equal(await luciaEvent, null, 'outro mercadinho não pode receber o pedido')

    // Estoque NÃO é baixado na criação (só quando o comerciante aceita).
    const { rows } = await t.db.query('SELECT stock_qty FROM products WHERE id = $1', [CREME])
    assert.equal(rows[0].stock_qty, 24)
    ze.close()
    lucia.close()
  })

  it('recusa estoque insuficiente sem gravar nada nem emitir evento', async () => {
    const ze = await socketFor(ZE)
    const event = nextEvent(ze, 800)
    const before = (await t.db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n

    const res = await post({ items: [{ productId: CREME, quantity: 99 }] })
    assert.equal(res.status, 422) // contrato da API: estoque insuficiente = 422
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'INSUFFICIENT_STOCK')
    assert.equal((await t.db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n, before)
    assert.equal(await event, null)
    ze.close()
  })

  it('recusa itens de dois mercadinhos no mesmo pedido', async () => {
    const res = await post({ items: [{ productId: CREME, quantity: 1 }, { productId: SUCO_LUCIA, quantity: 1 }] })
    assert.equal(res.status, 422)
  })

  it('valida o corpo e exige papel de cliente', async () => {
    assert.equal((await post({ items: [] })).status, 400)
    assert.equal((await post({ items: [{ productId: CREME, quantity: 1 }] }, tokenFor(ZE))).status, 403)
    assert.equal((await post({ items: [{ productId: CREME, quantity: 1 }] }, 'token-invalido')).status, 401)
  })

  it('rejeita WebSocket sem token', async () => {
    await assert.rejects(
      new Promise((resolve, reject) => {
        const s = connect(t.baseUrl, { transports: ['websocket'] })
        s.on('connect', () => resolve(s))
        s.on('connect_error', (e) => {
          s.close()
          reject(e)
        })
      }),
    )
  })
})

describe('GET /api/orders', () => {
  it('comerciante vê só os pedidos da própria loja', async () => {
    const res = await fetch(`${t.baseUrl}/api/orders`, { headers: { authorization: `Bearer ${tokenFor(LUCIA)}` } })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
  })
})
