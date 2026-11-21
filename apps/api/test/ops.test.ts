// Operação da loja: funil (Conversão), fila de impressão, bloqueio otimista e push.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { PrintJobDTO } from '../src/modules/ops/ops.types.js'
import { CREME, LUCIA, MARIA, ZE, nextEvent, startTestEnv, tokenFor, type TestEnv } from './helpers.js'

let t: TestEnv
const ze = () => tokenFor(ZE)
const maria = () => tokenFor(MARIA)
const order = (items: { productId: string; quantity: number }[], token = maria()) => t.api('POST', '/api/v1/orders', { token, body: { items } })

before(async () => {
  t = await startTestEnv()
})
after(() => t?.stop())

describe('funil e Conversão', () => {
  it('registra eventos anônimos e a Conversão = pedidos online ÷ visitas', async () => {
    const a = randomUUID()
    const b = randomUUID()
    for (const [session, type] of [
      [a, 'STORE_VIEW'],
      [a, 'ADD_TO_CART'],
      [b, 'STORE_VIEW'],
      [b, 'STORE_VIEW'], // mesma sessão repetida não conta duas vezes
    ] as const) {
      const r = await t.api('POST', '/api/v1/events', { body: { merchantId: ZE, sessionId: session, type } })
      assert.equal(r.status, 204)
    }
    assert.equal((await order([{ productId: CREME, quantity: 1 }])).status, 201)

    const { body } = await t.api('GET', '/api/v1/analytics/dashboard', { token: ze() })
    const c = body.kpis.conversion
    assert.equal(c.sessions, 2)
    assert.equal(c.onlineOrders, 1)
    assert.equal(c.value, 50)
    assert.equal(c.funnel.addToCart, 1)
  })

  it('rejeita evento inválido e ignora loja que não existe', async () => {
    assert.equal((await t.api('POST', '/api/v1/events', { body: { merchantId: ZE, sessionId: 'x', type: 'STORE_VIEW' } })).status, 400)
    const r = await t.api('POST', '/api/v1/events', { body: { merchantId: randomUUID(), sessionId: randomUUID(), type: 'STORE_VIEW' } })
    assert.equal(r.status, 204)
    const { rows } = await t.db.query(`SELECT 1 FROM store_events WHERE merchant_id NOT IN (SELECT id FROM users)`)
    assert.equal(rows.length, 0)
  })
})

describe('fila de impressão', () => {
  it('o pedido gera o job na mesma transação, o caixa recebe por WebSocket e confirma', async () => {
    const socket = await t.socketFor(ZE)
    const live = nextEvent<PrintJobDTO>(socket, 'print:job')
    const res = await order([{ productId: CREME, quantity: 1 }])
    assert.equal(res.status, 201)

    const job = await live
    assert.ok(job, 'o caixa deveria receber print:job')
    assert.equal(job.orderId, res.body.id)
    assert.equal(job.order.items[0]!.name, 'Creme de Leite Nestlé 200g')
    socket.close()

    const pending = await t.api('GET', '/api/v1/print-jobs/pending', { token: ze() })
    assert.ok(pending.body.some((j: PrintJobDTO) => j.id === job.id))

    assert.equal((await t.api('POST', `/api/v1/print-jobs/${job.id}/ack`, { token: ze(), body: { ok: true } })).status, 204)
    const after = await t.api('GET', '/api/v1/print-jobs/pending', { token: ze() })
    assert.ok(!after.body.some((j: PrintJobDTO) => j.id === job.id))
    // Confirmar de novo (ou outra loja confirmar) não funciona.
    assert.equal((await t.api('POST', `/api/v1/print-jobs/${job.id}/ack`, { token: ze(), body: { ok: true } })).status, 404)
    assert.equal((await t.api('POST', `/api/v1/print-jobs/${job.id}/ack`, { token: tokenFor(LUCIA), body: { ok: true } })).status, 404)
  })

  it('caixa offline: o job espera em QUEUED; reimpressão cria a via seguinte; cliente não acessa', async () => {
    const res = await order([{ productId: CREME, quantity: 1 }]) // sem nenhum socket conectado
    const pending = await t.api('GET', '/api/v1/print-jobs/pending', { token: ze() })
    const job = pending.body.find((j: PrintJobDTO) => j.orderId === res.body.id)
    assert.ok(job)
    assert.equal(job.status, 'QUEUED')

    const again = await t.api('POST', `/api/v1/print-jobs/orders/${res.body.id}/reprint`, { token: ze() })
    assert.equal(again.status, 201)
    const { rows } = await t.db.query(`SELECT copy_no FROM print_jobs WHERE order_id = $1 ORDER BY copy_no`, [res.body.id])
    assert.deepEqual(rows.map((r) => r.copy_no), [1, 2])

    assert.equal((await t.api('GET', '/api/v1/print-jobs/pending', { token: maria() })).status, 403)
    assert.equal((await t.api('POST', `/api/v1/print-jobs/orders/${res.body.id}/reprint`, { token: tokenFor(LUCIA) })).status, 404)
  })

  it('auto_print desligado não gera job', async () => {
    await t.db.query(`INSERT INTO store_delivery_config (merchant_id, auto_print) VALUES ($1, FALSE) ON CONFLICT (merchant_id) DO UPDATE SET auto_print = FALSE`, [ZE])
    const res = await order([{ productId: CREME, quantity: 1 }])
    const { rows } = await t.db.query(`SELECT 1 FROM print_jobs WHERE order_id = $1`, [res.body.id])
    assert.equal(rows.length, 0)
    await t.db.query(`UPDATE store_delivery_config SET auto_print = TRUE WHERE merchant_id = $1`, [ZE])
  })
})

describe('bloqueio otimista', () => {
  it('aceitar e cancelar um pedido não escrevem em livro de estoque nem mexem no produto', async () => {
    const mov = async () => (await t.db.query(`SELECT count(*)::int AS n FROM stock_movements WHERE product_id = $1`, [CREME])).rows[0].n as number
    const before = await mov()
    const o = await order([{ productId: CREME, quantity: 3 }])
    await t.api('PATCH', `/api/v1/orders/${o.body.id}/status`, { token: ze(), body: { status: 'IN_PREPARATION' } })
    await t.api('PATCH', `/api/v1/orders/${o.body.id}/status`, { token: ze(), body: { status: 'CANCELLED' } })
    assert.equal(await mov(), before)
    assert.equal((await t.api('PATCH', `/api/v1/products/${CREME}/stock`, { token: ze(), body: { delta: 5 } })).status, 404)
  })

  it('edição com versão velha vira 409; com a versão atual passa e incrementa', async () => {
    const mine = await t.api('GET', '/api/v1/products/mine?limit=500', { token: ze() })
    const p = mine.body.find((x: { id: string }) => x.id === CREME)
    const ok = await t.api('PUT', `/api/v1/products/${CREME}`, { token: ze(), body: { price: 4.5, version: p.version } })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.version, p.version + 1)
    const stale = await t.api('PUT', `/api/v1/products/${CREME}`, { token: ze(), body: { price: 4.6, version: p.version } })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error.code, 'STALE_VERSION')
    // A vitrine pública nunca expõe a versão.
    const pub = await t.api('GET', `/api/v1/products/${CREME}`)
    assert.equal(pub.body.version, undefined)
  })
})

describe('push', () => {
  it('sem chaves VAPID a rota de chave responde 501; inscrição exige login e fica por aparelho', async () => {
    assert.equal((await t.api('GET', '/api/v1/push/key')).status, 501)
    const sub = { endpoint: 'https://push.example.test/abc123', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } }
    assert.equal((await t.api('POST', '/api/v1/push/subscribe', { body: sub })).status, 401)
    assert.equal((await t.api('POST', '/api/v1/push/subscribe', { token: ze(), body: sub })).status, 204)
    assert.equal((await t.api('POST', '/api/v1/push/subscribe', { token: ze(), body: sub })).status, 204) // idempotente
    const { rows } = await t.db.query(`SELECT user_id, app FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint])
    assert.deepEqual(rows, [{ user_id: ZE, app: 'MERCHANT' }])
    assert.equal((await t.api('POST', '/api/v1/push/unsubscribe', { token: ze(), body: { endpoint: sub.endpoint } })).status, 204)
  })
})
