import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { OrderDTO } from '../src/modules/orders/orders.types.js'
import {
  CREME,
  LUCIA,
  MARIA,
  PAO,
  SUCO_LUCIA,
  nextEvent,
  startTestEnv,
  tokenFor,
  ZE,
  type TestEnv,
} from './helpers.js'

let t: TestEnv
const ze = () => tokenFor(ZE)
const maria = () => tokenFor(MARIA)
before(async () => {
  t = await startTestEnv(54333)
})
after(() => t?.stop())

const place = async (items: { productId: string; quantity: number }[], extra: object = {}) => {
  const res = await t.api('POST', '/api/v1/orders', { token: maria(), body: { items, ...extra } })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res.body as OrderDTO
}
const setStatus = (id: string, status: string, token = ze()) => t.api('PATCH', `/api/v1/orders/${id}/status`, { token, body: { status } })

describe('Kanban: PATCH /orders/:id/status', () => {
  it('percorre PENDING → IN_PREPARATION → READY → COMPLETED; aceitar só muda o status', async () => {
    const order = await place([{ productId: CREME, quantity: 4 }], { customerName: 'Maria S.', phone: '85999990000', deliveryMethod: 'Retirar na loja', notes: 'sem sacola' })
    assert.deepEqual(order.contact, { name: 'Maria S.', phone: '85999990000', deliveryMethod: 'Retirar na loja', deliveryAddress: null, paymentMethod: null, notes: 'sem sacola' })

    const ze$ = await t.socketFor(ZE)
    const maria$ = await t.socketFor(MARIA)
    const lucia$ = await t.socketFor(LUCIA)
    const toZe = nextEvent<OrderDTO>(ze$, 'order:status_updated')
    const toMaria = nextEvent<OrderDTO>(maria$, 'order:status_updated')
    const toLucia = nextEvent<OrderDTO>(lucia$, 'order:status_updated', 700)

    const accepted = await setStatus(order.id, 'IN_PREPARATION')
    assert.equal(accepted.status, 200)
    assert.equal(accepted.body.status, 'IN_PREPARATION')
    assert.equal((await toMaria)?.status, 'IN_PREPARATION', 'o cliente acompanha o pedido em tempo real')
    assert.equal((await toZe)?.id, order.id)
    assert.equal(await toLucia, null, 'outra loja não recebe')

    assert.equal((await setStatus(order.id, 'READY')).body.status, 'READY')
    assert.equal((await setStatus(order.id, 'COMPLETED')).body.status, 'COMPLETED')
    for (const s of [ze$, maria$, lucia$]) s.close()
  })

  it('transição inválida → 409 com as opções permitidas', async () => {
    const order = await place([{ productId: CREME, quantity: 1 }])
    const skip = await setStatus(order.id, 'READY') // pula a preparação
    assert.equal(skip.status, 409)
    assert.equal(skip.body.error.code, 'INVALID_TRANSITION')
    assert.deepEqual(skip.body.error.details.allowed, ['IN_PREPARATION', 'CANCELLED'])
    await setStatus(order.id, 'CANCELLED')
    assert.equal((await setStatus(order.id, 'IN_PREPARATION')).status, 409) // pedido cancelado é final
  })

  it('aceitar e cancelar um pedido em preparo só mudam o status (não há estoque)', async () => {
    const order = await place([{ productId: CREME, quantity: 5 }])
    assert.equal((await setStatus(order.id, 'IN_PREPARATION')).status, 200)
    assert.equal((await setStatus(order.id, 'CANCELLED')).status, 200)
    assert.equal((await t.api('GET', `/api/v1/orders/${order.id}`, { token: ze() })).body.status, 'CANCELLED')
  })

  it('pedido grande é aceito: não há saldo de produto para esgotar', async () => {
    const order = await place([{ productId: PAO, quantity: 50 }])
    assert.equal((await setStatus(order.id, 'IN_PREPARATION')).status, 200)
  })

  it('o mesmo pedido aceito duas vezes ao mesmo tempo: um aceite e um 409', async () => {
    const order = await place([{ productId: CREME, quantity: 2 }])
    const results = await Promise.all([setStatus(order.id, 'IN_PREPARATION'), setStatus(order.id, 'IN_PREPARATION')])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
  })

  it('só o comerciante dono altera: cliente 403, outra loja 404, sem token 401, status inválido 400', async () => {
    const order = await place([{ productId: CREME, quantity: 1 }])
    assert.equal((await setStatus(order.id, 'IN_PREPARATION', maria())).status, 403)
    assert.equal((await setStatus(order.id, 'IN_PREPARATION', tokenFor(LUCIA))).status, 404)
    assert.equal((await t.api('PATCH', `/api/v1/orders/${order.id}/status`, { body: { status: 'READY' } })).status, 401)
    assert.equal((await setStatus(order.id, 'ENTREGUE')).status, 400)
    assert.equal((await setStatus('11111111-1111-4111-8111-1111111111ff', 'READY')).status, 404)
  })
})

describe('consulta de pedidos', () => {
  it('GET /orders?active=true entrega o Kanban; GET /orders/:id respeita o dono', async () => {
    const order = await place([{ productId: CREME, quantity: 1 }])
    const board = await t.api('GET', '/api/v1/orders?active=true', { token: ze() })
    assert.ok(board.body.length > 0)
    assert.ok(board.body.every((o: OrderDTO) => !['COMPLETED', 'CANCELLED'].includes(o.status)))
    assert.ok(board.body.some((o: OrderDTO) => o.id === order.id))
    assert.deepEqual((await t.api('GET', '/api/v1/orders', { token: tokenFor(LUCIA) })).body, [])

    assert.equal((await t.api('GET', `/api/v1/orders/${order.id}`, { token: maria() })).status, 200)
    assert.equal((await t.api('GET', `/api/v1/orders/${order.id}`, { token: ze() })).status, 200)
    assert.equal((await t.api('GET', `/api/v1/orders/${order.id}`, { token: tokenFor(LUCIA) })).status, 404)
    assert.equal((await t.api('GET', '/api/v1/orders?status=NOPE', { token: ze() })).status, 400)

    const done = await t.api('GET', '/api/v1/orders?status=COMPLETED', { token: ze() })
    assert.ok(done.body.every((o: OrderDTO) => o.status === 'COMPLETED'))
  })
})

describe('Modo PDV: POST /pos/sales', () => {
  it('registra venda de balcão já concluída', async () => {
    const res = await t.api('POST', '/api/v1/pos/sales', { token: ze(), body: { items: [{ productId: CREME, quantity: 2 }, { productId: CREME, quantity: 1 }] } })
    assert.equal(res.status, 201)
    assert.equal(res.body.channel, 'POS')
    assert.equal(res.body.status, 'COMPLETED')
    assert.equal(res.body.customer, null)
    assert.equal(res.body.totalPrice, 12.87) // 3 × 4,29

    const history = await t.api('GET', '/api/v1/orders?channel=POS', { token: ze() })
    assert.deepEqual(history.body.map((o: OrderDTO) => o.id), [res.body.id])
    assert.equal((await setStatus(res.body.id, 'CANCELLED')).status, 409)
  })

  it('recusa produto de outra loja (422) e cliente (403) sem gravar nada', async () => {
    const orders = (await t.db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n

    const foreign = await t.api('POST', '/api/v1/pos/sales', { token: ze(), body: { items: [{ productId: SUCO_LUCIA, quantity: 1 }] } })
    assert.equal(foreign.status, 422)
    assert.equal(foreign.body.error.code, 'FOREIGN_PRODUCT')
    assert.equal((await t.api('POST', '/api/v1/pos/sales', { token: maria(), body: { items: [{ productId: CREME, quantity: 1 }] } })).status, 403)

    assert.equal((await t.db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n, orders)
  })
})

describe('Paginação: GET /orders?limit&offset', () => {
  const page = async (qs: string) => {
    const res = await fetch(`${t.baseUrl}/api/v1/orders?${qs}`, { headers: { authorization: `Bearer ${ze()}` } })
    return { status: res.status, total: Number(res.headers.get('x-total-count')), body: (await res.json()) as OrderDTO[] }
  }

  it('percorre todas as páginas sem repetir nem pular pedido e informa o total em X-Total-Count', async () => {
    for (let n = 0; n < 3; n++) await place([{ productId: CREME, quantity: 1 }])
    const all = await page('limit=200')
    assert.equal(all.status, 200)
    assert.ok(all.total >= 3 && all.body.length === all.total, 'o total bate com a lista completa')

    const seen: string[] = []
    for (let offset = 0; ; offset += 2) {
      const p = await page(`limit=2&offset=${offset}`)
      assert.equal(p.total, all.total, 'o total ignora limit/offset')
      seen.push(...p.body.map((o) => o.id))
      if (p.body.length < 2) break
    }
    assert.deepEqual(seen, all.body.map((o) => o.id))
    assert.equal(new Set(seen).size, seen.length)
    assert.deepEqual((await page(`limit=2&offset=${all.total}`)).body, [], 'além do fim vem lista vazia')
  })

  it('o total respeita os filtros e offset negativo → 400', async () => {
    const pending = await page('status=PENDING&limit=1')
    assert.equal(pending.total, (await page('status=PENDING&limit=200')).body.length)
    assert.equal((await page('offset=-1')).status, 400)
  })
})
