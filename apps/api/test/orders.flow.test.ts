import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { OrderDTO } from '../src/modules/orders/orders.types.js'
import {
  ARROZ_LUCIA,
  ARROZ_ZE,
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

const stockOf = async (id: string) => (await t.db.query('SELECT stock_qty FROM products WHERE id = $1', [id])).rows[0].stock_qty as number
const place = async (items: { productId: string; quantity: number }[], extra: object = {}) => {
  const res = await t.api('POST', '/api/v1/orders', { token: maria(), body: { items, ...extra } })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res.body as OrderDTO
}
const setStatus = (id: string, status: string, token = ze()) => t.api('PATCH', `/api/v1/orders/${id}/status`, { token, body: { status } })

describe('Kanban: PATCH /orders/:id/status', () => {
  it('percorre PENDING → IN_PREPARATION → READY → COMPLETED; baixa o estoque só ao aceitar', async () => {
    const order = await place([{ productId: CREME, quantity: 4 }], { customerName: 'Maria S.', phone: '85999990000', deliveryMethod: 'Retirar na loja', notes: 'sem sacola' })
    assert.deepEqual(order.contact, { name: 'Maria S.', phone: '85999990000', deliveryMethod: 'Retirar na loja', deliveryAddress: null, paymentMethod: null, notes: 'sem sacola' })
    assert.equal(await stockOf(CREME), 24)

    const ze$ = await t.socketFor(ZE)
    const maria$ = await t.socketFor(MARIA)
    const lucia$ = await t.socketFor(LUCIA)
    const toZe = nextEvent<OrderDTO>(ze$, 'order:status_updated')
    const toMaria = nextEvent<OrderDTO>(maria$, 'order:status_updated')
    const toLucia = nextEvent<OrderDTO>(lucia$, 'order:status_updated', 700)

    const accepted = await setStatus(order.id, 'IN_PREPARATION')
    assert.equal(accepted.status, 200)
    assert.equal(accepted.body.status, 'IN_PREPARATION')
    assert.equal(await stockOf(CREME), 20)
    assert.equal((await toMaria)?.status, 'IN_PREPARATION', 'o cliente acompanha o pedido em tempo real')
    assert.equal((await toZe)?.id, order.id)
    assert.equal(await toLucia, null, 'outra loja não recebe')

    assert.equal((await setStatus(order.id, 'READY')).body.status, 'READY')
    assert.equal((await setStatus(order.id, 'COMPLETED')).body.status, 'COMPLETED')
    assert.equal(await stockOf(CREME), 20, 'concluir não mexe no estoque de novo')
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
    assert.equal(await stockOf(CREME), 20, 'cancelar um PENDING não mexe no estoque')
  })

  it('cancelar um pedido em preparo devolve o estoque', async () => {
    const order = await place([{ productId: CREME, quantity: 5 }])
    await setStatus(order.id, 'IN_PREPARATION')
    assert.equal(await stockOf(CREME), 15)
    assert.equal((await setStatus(order.id, 'CANCELLED')).status, 200)
    assert.equal(await stockOf(CREME), 20)
  })

  it('aceitar sem estoque suficiente → 422 e nada muda', async () => {
    const a = await place([{ productId: PAO, quantity: 4 }])
    const b = await place([{ productId: PAO, quantity: 3 }, { productId: CREME, quantity: 1 }]) // os dois "cabiam" quando foram criados
    assert.equal((await setStatus(a.id, 'IN_PREPARATION')).status, 200)
    assert.equal(await stockOf(PAO), 1)

    const refused = await setStatus(b.id, 'IN_PREPARATION')
    assert.equal(refused.status, 422)
    assert.equal(refused.body.error.code, 'INSUFFICIENT_STOCK')
    assert.deepEqual(refused.body.error.details.shortages, [{ productId: PAO, requested: 3, available: 1 }])
    assert.equal(await stockOf(PAO), 1)
    assert.equal(await stockOf(CREME), 20, 'a baixa parcial é desfeita (transação)')
    assert.equal((await t.api('GET', `/api/v1/orders/${b.id}`, { token: ze() })).body.status, 'PENDING')
  })

  it('aceites simultâneos competindo pelo mesmo estoque: nunca fica negativo', async () => {
    const created = await t.api('POST', '/api/v1/products', { token: ze(), body: { name: 'Último lote', categoryId: 1, price: 10, stockQty: 3 } })
    const productId = created.body.id as string
    const orders = await Promise.all(Array.from({ length: 4 }, () => place([{ productId, quantity: 2 }])))

    const results = await Promise.all(orders.map((o) => setStatus(o.id, 'IN_PREPARATION')))
    assert.equal(results.filter((r) => r.status === 200).length, 1) // 3 un → só um pedido de 2 cabe
    assert.deepEqual([...new Set(results.filter((r) => r.status !== 200).map((r) => r.status))], [422])
    assert.equal(await stockOf(productId), 1)
  })

  it('o mesmo pedido aceito duas vezes ao mesmo tempo baixa o estoque uma vez só', async () => {
    const before = await stockOf(CREME)
    const order = await place([{ productId: CREME, quantity: 2 }])
    const results = await Promise.all([setStatus(order.id, 'IN_PREPARATION'), setStatus(order.id, 'IN_PREPARATION')])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
    assert.equal(await stockOf(CREME), before - 2)
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
  it('registra venda de balcão concluída e baixa o estoque na hora', async () => {
    const before = await stockOf(CREME)
    const res = await t.api('POST', '/api/v1/pos/sales', { token: ze(), body: { items: [{ productId: CREME, quantity: 2 }, { productId: CREME, quantity: 1 }] } })
    assert.equal(res.status, 201)
    assert.equal(res.body.channel, 'POS')
    assert.equal(res.body.status, 'COMPLETED')
    assert.equal(res.body.customer, null)
    assert.equal(res.body.totalPrice, 12.87) // 3 × 4,29
    assert.equal(await stockOf(CREME), before - 3)

    const history = await t.api('GET', '/api/v1/orders?channel=POS', { token: ze() })
    assert.deepEqual(history.body.map((o: OrderDTO) => o.id), [res.body.id])
    assert.equal((await setStatus(res.body.id, 'CANCELLED')).status, 409)
  })

  it('recusa estoque insuficiente (422), produto de outra loja (422) e cliente (403) sem gravar nada', async () => {
    const before = await stockOf(CREME)
    const orders = (await t.db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n

    const over = await t.api('POST', '/api/v1/pos/sales', { token: ze(), body: { items: [{ productId: CREME, quantity: 99 }] } })
    assert.equal(over.status, 422)
    assert.equal(over.body.error.code, 'INSUFFICIENT_STOCK')
    const foreign = await t.api('POST', '/api/v1/pos/sales', { token: ze(), body: { items: [{ productId: SUCO_LUCIA, quantity: 1 }] } })
    assert.equal(foreign.status, 422)
    assert.equal(foreign.body.error.code, 'FOREIGN_PRODUCT')
    assert.equal((await t.api('POST', '/api/v1/pos/sales', { token: maria(), body: { items: [{ productId: CREME, quantity: 1 }] } })).status, 403)

    assert.equal(await stockOf(CREME), before)
    assert.equal((await t.db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n, orders)
  })
})

describe('Rede Anti-Ruptura B2B', () => {
  it('acha o excedente do vizinho pelo código de barras (estoque acima da reserva), com distância', async () => {
    const res = await t.api('GET', '/api/v1/b2b/search?barcode=7896006711119', { token: ze() })
    assert.equal(res.status, 200)
    assert.equal(res.body.length, 1)
    const [offer] = res.body
    assert.equal(offer.productId, ARROZ_LUCIA)
    assert.equal(offer.storeName, 'Mercadinho da Dona Lúcia')
    assert.equal(offer.surplusQty, 25) // 30 em estoque − 5 de reserva
    assert.equal(offer.sameNeighborhood, true)
    assert.ok(offer.distanceKm > 0.2 && offer.distanceKm < 1, `distância ${offer.distanceKm}`)
  })

  it('busca pelo productId (usa o código de barras do produto) e valida a entrada', async () => {
    assert.equal((await t.api('GET', `/api/v1/b2b/search?productId=${ARROZ_ZE}`, { token: ze() })).body.length, 1)
    assert.equal((await t.api('GET', `/api/v1/b2b/search?productId=${CREME}`, { token: ze() })).status, 422) // sem barcode
    assert.equal((await t.api('GET', `/api/v1/b2b/search?productId=${ARROZ_LUCIA}`, { token: ze() })).status, 404) // não é meu
    assert.equal((await t.api('GET', '/api/v1/b2b/search', { token: ze() })).status, 400)
    assert.equal((await t.api('GET', '/api/v1/b2b/search?barcode=7896006711119', { token: maria() })).status, 403)
  })

  it('não oferece a própria loja nem produto esgotado', async () => {
    assert.deepEqual((await t.api('GET', '/api/v1/b2b/search?barcode=7896006711119', { token: tokenFor(LUCIA) })).body, []) // Zé está esgotado
  })

  it('alerta de ruptura: meus esgotados que a vizinhança supre', async () => {
    const res = await t.api('GET', '/api/v1/b2b/alerts', { token: ze() })
    assert.equal(res.body.length, 1)
    assert.equal(res.body[0].productId, ARROZ_ZE)
    assert.equal(res.body[0].offers[0].storeName, 'Mercadinho da Dona Lúcia')
  })

  it('a reserva própria nunca é oferecida: estoque ≤ reserva some da rede', async () => {
    await t.api('PATCH', `/api/v1/products/${ARROZ_LUCIA}/stock`, { token: tokenFor(LUCIA), body: { set: 5 } })
    assert.deepEqual((await t.api('GET', '/api/v1/b2b/search?barcode=7896006711119', { token: ze() })).body, [])
  })
})
