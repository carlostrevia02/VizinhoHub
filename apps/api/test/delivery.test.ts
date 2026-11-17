// Logística: config da loja, pedido com entrega (taxa/raio), pool de entregadores, aceite atômico, PIN e rastreio.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createDeliveryService } from '../src/modules/delivery/delivery.service.js'
import { CREME, LUCIA, MARIA, nextEvent, startTestEnv, tokenFor, ZE, type TestEnv } from './helpers.js'

let t: TestEnv
const ze = () => tokenFor(ZE)
const lucia = () => tokenFor(LUCIA)
const maria = () => tokenFor(MARIA)

// Loja do Zé (seed): -3.7371, -38.4960. A ~330 m e a ~15 km.
const NEAR = { deliveryLat: -3.74, deliveryLng: -38.495 }
const FAR = { deliveryLat: -3.85, deliveryLng: -38.4 }
const STORE = { lat: -3.7371, lng: -38.496 }

interface Courier {
  id: string
  token: string
}
const couriers: Courier[] = []

async function newCourier(n: number): Promise<Courier> {
  const reg = await t.api('POST', '/api/auth/register', { body: { name: `Entregador ${n}`, email: `courier${n}@vizinhohub.test`, password: 'vizinho123' } })
  assert.equal(reg.status, 201, JSON.stringify(reg.body))
  const token = reg.body.token as string
  const profile = await t.api('POST', '/api/delivery/courier', { token, body: { vehicle: 'MOTO', neighborhood: 'Aldeota', city: 'Fortaleza' } })
  assert.equal(profile.status, 201, JSON.stringify(profile.body))
  const status = await t.api('PUT', '/api/delivery/courier/status', { token, body: { status: 'AVAILABLE' } })
  assert.equal(status.status, 200)
  const loc = await t.api('PUT', '/api/delivery/courier/location', { token, body: { lat: STORE.lat + 0.001 * n, lng: STORE.lng } })
  assert.equal(loc.status, 200)
  assert.equal(loc.body.accepted, true)
  return { id: reg.body.user.id as string, token }
}

/** Pedido do Maria para entrega, levado até READY pelo Zé. */
async function readyOrder(over: Record<string, unknown> = {}): Promise<string> {
  const res = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: CREME, quantity: 1 }], fulfillment: 'DELIVERY', deliveryAddress: 'Rua A, 100', ...NEAR, ...over } })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  const id = res.body.id as string
  for (const status of ['IN_PREPARATION', 'READY']) {
    const r = await t.api('PATCH', `/api/orders/${id}/status`, { token: ze(), body: { status } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
  }
  return id
}
const callCourier = (orderId: string, token = ze()) => t.api('POST', '/api/delivery/deliveries', { token, body: { orderId } })
const pinOf = async (deliveryId: string) => (await t.db.query('SELECT pin_code, pin_attempts, status FROM deliveries WHERE id = $1', [deliveryId])).rows[0]

before(async () => {
  t = await startTestEnv()
  const cfg = await t.api('PUT', '/api/delivery/config', { token: ze(), body: { deliveryEnabled: true, deliveryRadiusM: 3000, deliveryFee: 6.5 } })
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body))
  for (let n = 1; n <= 8; n++) couriers.push(await newCourier(n))
})
after(() => t?.stop())

describe('permissões', () => {
  it('sem login → 401; cliente na área do lojista → 403; lojista na área do entregador → 403', async () => {
    assert.equal((await t.api('GET', '/api/delivery/config')).status, 401)
    assert.equal((await t.api('GET', '/api/delivery/config', { token: maria() })).status, 403)
    assert.equal((await t.api('POST', '/api/delivery/deliveries', { token: maria(), body: { orderId: '00000000-0000-4000-8000-000000000000' } })).status, 403)
    assert.equal((await t.api('GET', '/api/delivery/courier/offers', { token: ze() })).status, 403)
    assert.equal((await t.api('POST', '/api/delivery/courier', { token: ze(), body: { vehicle: 'MOTO', neighborhood: 'A', city: 'B' } })).status, 403)
  })

  it('usuário sem perfil de entregador → 403 NOT_A_COURIER', async () => {
    const res = await t.api('GET', '/api/delivery/courier/offers', { token: maria() })
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'NOT_A_COURIER')
  })

  it('outro lojista não chama entregador do pedido alheio (404) e outro cliente não vê a entrega', async () => {
    const orderId = await readyOrder()
    assert.equal((await callCourier(orderId, lucia())).status, 404)
    assert.equal((await t.api('GET', `/api/delivery/orders/${orderId}`, { token: lucia() })).status, 404)
    assert.equal((await t.api('GET', `/api/delivery/orders/${orderId}`, { token: couriers[0]!.token })).status, 404)
  })
})

describe('configuração da loja', () => {
  it('GET devolve a config salva; a rota pública mostra só taxa e raio', async () => {
    const mine = await t.api('GET', '/api/delivery/config', { token: ze() })
    assert.equal(mine.body.deliveryEnabled, true)
    assert.equal(mine.body.deliveryFee, 6.5)
    assert.equal(mine.body.deliveryRadiusM, 3000)
    assert.equal(mine.body.hasOwnFleet, false)
    const pub = await t.api('GET', `/api/delivery/stores/${ZE}`)
    assert.deepEqual(pub.body, { deliveryEnabled: true, deliveryRadiusM: 3000, deliveryFee: 6.5 })
  })

  it('raio do Flash maior que o de entrega → 422; campo inválido → 400', async () => {
    const bad = await t.api('PUT', '/api/delivery/config', { token: ze(), body: { flashRadiusM: 1500, deliveryRadiusM: 1000 } })
    assert.equal(bad.status, 422)
    assert.equal(bad.body.error.code, 'FLASH_OUTSIDE_DELIVERY')
    assert.equal((await t.api('PUT', '/api/delivery/config', { token: ze(), body: { deliveryFee: 1.234 } })).status, 400)
    assert.equal((await t.api('PUT', '/api/delivery/config', { token: ze(), body: {} })).status, 400)
  })
})

describe('pedido com entrega: taxa e raio', () => {
  it('dentro do raio: grava fulfillment, taxa e destino; total_price continua só a mercadoria', async () => {
    const res = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: CREME, quantity: 2 }], fulfillment: 'DELIVERY', deliveryAddress: 'Rua A, 100', ...NEAR } })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.totalPrice, 8.58)
    const row = (await t.db.query('SELECT fulfillment, delivery_fee::float8 AS fee, delivery_lat::float8 AS lat, total_price::float8 AS total FROM orders WHERE id = $1', [res.body.id])).rows[0]
    assert.equal(row.fulfillment, 'DELIVERY')
    assert.equal(row.fee, 6.5)
    assert.equal(row.lat, NEAR.deliveryLat)
    assert.equal(row.total, 8.58)
    const track = await t.api('GET', `/api/delivery/orders/${res.body.id}`, { token: maria() })
    assert.equal(track.status, 200)
    assert.equal(track.body.fulfillment, 'DELIVERY')
    assert.equal(track.body.deliveryFee, 6.5)
    assert.equal(track.body.delivery, null)
  })

  it('fora do raio → 422 OUT_OF_RADIUS e nada é gravado', async () => {
    const before = (await t.db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n
    const res = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: CREME, quantity: 1 }], fulfillment: 'DELIVERY', ...FAR } })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'OUT_OF_RADIUS')
    assert.ok(res.body.error.details.distanceM > 3000)
    assert.equal((await t.db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n, before)
  })

  it('sem localização → 422; loja sem entrega ligada → 422; retirada segue como antes (taxa 0)', async () => {
    const noLoc = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: CREME, quantity: 1 }], fulfillment: 'DELIVERY' } })
    assert.equal(noLoc.body.error.code, 'DELIVERY_LOCATION_REQUIRED')
    // Produto da Lúcia (não configurou entrega).
    const off = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: 'bbbbbbbb-0000-4000-8000-000000000002', quantity: 1 }], fulfillment: 'DELIVERY', ...NEAR } })
    assert.equal(off.status, 422)
    assert.equal(off.body.error.code, 'DELIVERY_UNAVAILABLE')
    const pickup = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: CREME, quantity: 1 }], fulfillment: 'PICKUP' } })
    assert.equal(pickup.status, 201)
    const row = (await t.db.query('SELECT fulfillment, delivery_fee::float8 AS fee FROM orders WHERE id = $1', [pickup.body.id])).rows[0]
    assert.deepEqual(row, { fulfillment: 'PICKUP', fee: 0 })
  })
})

describe('chamar entregador', () => {
  it('pedido não pronto → 409; pedido de retirada → 422', async () => {
    const pending = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: CREME, quantity: 1 }], fulfillment: 'DELIVERY', ...NEAR } })
    const notReady = await callCourier(pending.body.id)
    assert.equal(notReady.status, 409)
    assert.equal(notReady.body.error.code, 'ORDER_NOT_READY')
    const pickup = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: CREME, quantity: 1 }] } })
    assert.equal((await callCourier(pickup.body.id)).body.error.code, 'NOT_A_DELIVERY_ORDER')
  })

  it('cria a entrega com PIN, convida os 8 e avisa o entregador pelo socket; repete → 409', async () => {
    const orderId = await readyOrder()
    const courierSocket = await t.socketFor(couriers[0]!.id)
    const customerSocket = await t.socketFor(MARIA)
    try {
      const offerEvent = nextEvent<{ deliveryId: string; storeName: string; courierFee: number }>(courierSocket, 'delivery:offered')
      const res = await callCourier(orderId)
      assert.equal(res.status, 201, JSON.stringify(res.body))
      assert.equal(res.body.offered, 8)
      assert.equal(res.body.delivery.status, 'OFFERED')
      assert.equal(res.body.delivery.courierFee, 6.5, 'repasse registrado = taxa do pedido (sem mover dinheiro)')
      assert.match(res.body.delivery.pinCode, /^\d{4}$/)
      assert.equal(res.body.delivery.courierId, null)
      const ev = await offerEvent
      assert.equal(ev?.deliveryId, res.body.delivery.id)
      assert.equal(ev?.storeName, 'Mercadinho do Zé')

      const offers = await t.api('GET', '/api/delivery/courier/offers', { token: couriers[0]!.token })
      assert.equal(offers.body.length >= 1, true)
      assert.equal(offers.body.some((o: { deliveryId: string }) => o.deliveryId === res.body.delivery.id), true)

      assert.equal((await callCourier(orderId)).status, 409)
    } finally {
      courierSocket.close()
      customerSocket.close()
    }
  })
})

describe('aceite atômico (anti-race)', () => {
  it('8 entregadores aceitando ao mesmo tempo: só 1 leva; os outros 7 recebem 409', async () => {
    const orderId = await readyOrder()
    const delivery = (await callCourier(orderId)).body.delivery
    assert.equal((await t.db.query('SELECT count(*)::int AS n FROM delivery_offers WHERE delivery_id = $1', [delivery.id])).rows[0].n, 8)

    const results = await Promise.all(couriers.map((c) => t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/accept`, { token: c.token })))
    const winners = results.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 200)
    const losers = results.filter((r) => r.status !== 200)
    assert.equal(winners.length, 1, JSON.stringify(results.map((r) => r.status)))
    assert.equal(losers.length, 7)
    for (const l of losers) {
      assert.equal(l.status, 409)
      assert.equal(l.body.error.code, 'DELIVERY_TAKEN')
    }
    const win = couriers[winners[0]!.i]!
    assert.equal(winners[0]!.r.body.courierId, win.id)
    assert.equal(winners[0]!.r.body.pinCode, undefined, 'o PIN nunca vai para o entregador')

    const row = (await t.db.query('SELECT courier_id, status FROM deliveries WHERE id = $1', [delivery.id])).rows[0]
    assert.equal(row.courier_id, win.id)
    assert.equal(row.status, 'ACCEPTED')
    const statuses = (await t.db.query('SELECT user_id, status FROM couriers ORDER BY user_id')).rows
    assert.equal(statuses.filter((c) => c.status === 'BUSY').length, 1, 'só quem levou fica ocupado')
    assert.equal(statuses.find((c) => c.user_id === win.id)!.status, 'BUSY')
    const offerStates = (await t.db.query('SELECT status, count(*)::int AS n FROM delivery_offers WHERE delivery_id = $1 GROUP BY status', [delivery.id])).rows
    assert.deepEqual(Object.fromEntries(offerStates.map((o) => [o.status, o.n])), { ACCEPTED: 1, EXPIRED: 7 })

    // Libera o entregador para os testes seguintes: conclui a corrida (falha registrada).
    const fail = await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/fail`, { token: win.token, body: { reason: 'cliente ausente' } })
    assert.equal(fail.status, 200)
    assert.equal(fail.body.status, 'FAILED')
    assert.equal((await pinOf(delivery.id)).pin_code, null, 'entrega encerrada não guarda PIN')
    assert.equal((await t.db.query('SELECT status FROM couriers WHERE user_id = $1', [win.id])).rows[0].status, 'AVAILABLE')
  })

  it('quem não está disponível não aceita; convite alheio → 409', async () => {
    const orderId = await readyOrder()
    const delivery = (await callCourier(orderId)).body.delivery
    const [c1, c2] = [couriers[0]!, couriers[1]!]
    await t.api('PUT', '/api/delivery/courier/status', { token: c1.token, body: { status: 'OFFLINE' } })
    const off = await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/accept`, { token: c1.token })
    assert.equal(off.status, 409)
    assert.equal(off.body.error.code, 'COURIER_NOT_AVAILABLE')
    await t.api('PUT', '/api/delivery/courier/status', { token: c1.token, body: { status: 'AVAILABLE' } })
    // Um usuário sem convite (Maria virando entregador agora) não pega a corrida.
    await t.api('POST', '/api/delivery/courier', { token: maria(), body: { vehicle: 'BIKE', neighborhood: 'Aldeota', city: 'Fortaleza' } })
    await t.api('PUT', '/api/delivery/courier/status', { token: maria(), body: { status: 'AVAILABLE' } })
    const noOffer = await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/accept`, { token: maria() })
    assert.equal(noOffer.status, 409)
    // Cancela o chamado para não interferir: c2 aceita e desiste.
    const ok = await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/accept`, { token: c2.token })
    assert.equal(ok.status, 200)
    await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/fail`, { token: c2.token, body: { reason: 'teste' } })
    await t.api('PUT', '/api/delivery/courier/status', { token: maria(), body: { status: 'OFFLINE' } })
  })
})

describe('PIN de entrega', () => {
  it('errado conta tentativa, trava na 5ª (423), lojista libera, PIN certo conclui e o PIN vira NULL', async () => {
    const orderId = await readyOrder()
    const delivery = (await callCourier(orderId)).body.delivery
    const courier = couriers[2]!
    assert.equal((await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/accept`, { token: courier.token })).status, 200)
    const deliver = (pin: string) => t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/deliver`, { token: courier.token, body: { pin } })
    const wrong = delivery.pinCode === '0000' ? '1111' : '0000'

    // Antes de retirar o pedido não dá para concluir.
    assert.equal((await deliver(delivery.pinCode)).status, 409)
    assert.equal((await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/pickup`, { token: courier.token })).body.status, 'PICKED_UP')
    assert.equal((await deliver('12')).status, 400, 'PIN precisa ter 4 dígitos')

    for (let i = 1; i <= 4; i++) {
      const res = await deliver(wrong)
      assert.equal(res.status, 422)
      assert.equal(res.body.error.code, 'PIN_INVALID')
      assert.equal(res.body.error.details.attemptsLeft, 5 - i)
      assert.equal((await pinOf(delivery.id)).pin_attempts, i, 'a tentativa é gravada mesmo com a resposta de erro')
    }
    const fifth = await deliver(wrong)
    assert.equal(fifth.status, 423)
    assert.equal(fifth.body.error.code, 'PIN_LOCKED')
    assert.equal((await pinOf(delivery.id)).pin_attempts, 5)
    // Travada: nem o PIN certo passa.
    assert.equal((await deliver(delivery.pinCode)).status, 423)
    assert.equal((await pinOf(delivery.id)).status, 'PICKED_UP')

    // Lojista vê a trava, outro lojista não consegue liberar, o entregador também não.
    const listed = await t.api('GET', '/api/delivery/deliveries', { token: ze() })
    assert.equal(listed.body.find((d: { id: string }) => d.id === delivery.id).pinLocked, true)
    assert.equal((await t.api('POST', `/api/delivery/deliveries/${delivery.id}/unlock-pin`, { token: lucia() })).status, 404)
    assert.equal((await t.api('POST', `/api/delivery/deliveries/${delivery.id}/unlock-pin`, { token: courier.token })).status, 403)
    const unlocked = await t.api('POST', `/api/delivery/deliveries/${delivery.id}/unlock-pin`, { token: ze() })
    assert.equal(unlocked.status, 200)
    assert.equal(unlocked.body.pinLocked, false)
    assert.equal(unlocked.body.pinAttempts, 0)

    // O cliente vê o PIN (o novo) para mostrar ao entregador.
    const track = await t.api('GET', `/api/delivery/orders/${orderId}`, { token: maria() })
    const pin = track.body.delivery.pinCode as string
    assert.match(pin, /^\d{4}$/)
    assert.equal(track.body.delivery.status, 'PICKED_UP')
    assert.equal(track.body.courier.name, 'Entregador 3')

    const done = await deliver(pin)
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(done.body.status, 'DELIVERED')
    assert.equal(done.body.pinCode, undefined)
    const row = await pinOf(delivery.id)
    assert.equal(row.status, 'DELIVERED')
    assert.equal(row.pin_code, null, 'PIN purgado no momento da confirmação')
    const after = (await t.db.query(`SELECT d.delivered_at IS NOT NULL AS done, o.status AS order_status, c.status AS courier_status, c.deliveries_done
                                       FROM deliveries d JOIN orders o ON o.id = d.order_id JOIN couriers c ON c.user_id = d.courier_id WHERE d.id = $1`, [delivery.id])).rows[0]
    assert.deepEqual(after, { done: true, order_status: 'COMPLETED', courier_status: 'AVAILABLE', deliveries_done: 1 })
    // E o cliente já não recebe PIN.
    const trackAfter = await t.api('GET', `/api/delivery/orders/${orderId}`, { token: maria() })
    assert.equal(trackAfter.body.delivery.pinCode, undefined)
    // Concluir de novo não é possível.
    assert.equal((await deliver(pin)).status, 409)
  })

  it('outro entregador não mexe na corrida alheia (404)', async () => {
    const orderId = await readyOrder()
    const delivery = (await callCourier(orderId)).body.delivery
    assert.equal((await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/accept`, { token: couriers[3]!.token })).status, 200)
    const intruder = await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/deliver`, { token: couriers[4]!.token, body: { pin: delivery.pinCode } })
    assert.equal(intruder.status, 404)
    await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/fail`, { token: couriers[3]!.token, body: { reason: 'teste' } })
  })
})

describe('rastreamento', () => {
  it('posição: no máx. 1 a cada 5 s, repassada ao cliente em tempo real, gravada a cada ~15 s; offline não envia', async () => {
    const courier = couriers[5]!
    const orderId = await readyOrder()
    const customerSocket = await t.socketFor(MARIA)
    try {
      const delivery = (await callCourier(orderId)).body.delivery
      assert.equal((await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/accept`, { token: courier.token })).status, 200)
      const logCount = async () => (await t.db.query('SELECT count(*)::int AS n FROM courier_location_log WHERE delivery_id = $1', [delivery.id])).rows[0].n as number
      const rewind = (s: number) => t.db.query(`UPDATE couriers SET last_seen_at = now() - make_interval(secs => $2) WHERE user_id = $1`, [courier.id, s])
      const put = (lat: number) => t.api('PUT', '/api/delivery/courier/location', { token: courier.token, body: { lat, lng: -38.49 } })

      await rewind(10)
      const ev = nextEvent<{ deliveryId: string; lat: number; lng: number }>(customerSocket, 'delivery:location')
      const first = await put(-3.738)
      assert.deepEqual(first.body, { accepted: true })
      const point = await ev
      assert.equal(point?.deliveryId, delivery.id)
      assert.equal(point?.lat, -3.738)
      assert.equal(await logCount(), 1)

      assert.deepEqual((await put(-3.739)).body, { accepted: false }, 'dentro dos 5 s')
      await rewind(6)
      assert.deepEqual((await put(-3.7395)).body, { accepted: true })
      assert.equal(await logCount(), 1, 'ainda dentro dos 15 s do último ponto gravado')
      await t.db.query(`UPDATE courier_location_log SET recorded_at = now() - interval '20 seconds' WHERE delivery_id = $1`, [delivery.id])
      await rewind(6)
      assert.deepEqual((await put(-3.74)).body, { accepted: true })
      assert.equal(await logCount(), 2)

      const track = await t.api('GET', `/api/delivery/orders/${orderId}`, { token: maria() })
      assert.equal(track.body.courier.lat, -3.74)
      assert.deepEqual(track.body.store, STORE)

      const active = await t.api('GET', '/api/delivery/courier/active', { token: courier.token })
      assert.equal(active.body.id, delivery.id)
      assert.equal(active.body.pinCode, undefined)
      assert.equal(active.body.storeName, 'Mercadinho do Zé')

      await t.api('POST', `/api/delivery/courier/deliveries/${delivery.id}/fail`, { token: courier.token, body: { reason: 'teste' } })
      assert.equal((await t.api('GET', '/api/delivery/courier/active', { token: courier.token })).body, null)
    } finally {
      customerSocket.close()
    }
    await t.api('PUT', '/api/delivery/courier/status', { token: courier.token, body: { status: 'OFFLINE' } })
    const offline = await t.api('PUT', '/api/delivery/courier/location', { token: courier.token, body: { lat: -3.7, lng: -38.5 } })
    assert.equal(offline.status, 409)
    assert.equal(offline.body.error.code, 'COURIER_OFFLINE')
  })
})

describe('job de limpeza do GPS (LGPD)', () => {
  it('apaga só os pontos com mais de 30 dias', async () => {
    const orderId = await readyOrder()
    const delivery = (await callCourier(orderId)).body.delivery
    await t.db.query(
      `INSERT INTO courier_location_log (delivery_id, lat, lng, recorded_at) VALUES
         ($1, -3.7, -38.5, now() - interval '31 days'),
         ($1, -3.7, -38.5, now() - interval '45 days'),
         ($1, -3.7, -38.5, now() - interval '29 days'),
         ($1, -3.7, -38.5, now())`,
      [delivery.id],
    )
    const removed = await createDeliveryService({ db: t.db }).purgeOldLocations(30)
    assert.equal(removed >= 2, true)
    const left = (await t.db.query(`SELECT count(*)::int AS n, bool_and(recorded_at > now() - interval '30 days') AS all_recent FROM courier_location_log WHERE delivery_id = $1`, [delivery.id])).rows[0]
    assert.deepEqual(left, { n: 2, all_recent: true })
    assert.equal(await createDeliveryService({ db: t.db }).purgeOldLocations(30), 0, 'segunda rodada não acha mais nada')
  })
})

describe('frota própria: o lojista conduz a entrega', () => {
  const setFleet = async (hasOwnFleet: boolean) => {
    const r = await t.api('PUT', '/api/delivery/config', { token: ze(), body: { hasOwnFleet } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
  }
  const own = (id: string, action: 'pickup' | 'deliver' | 'fail', body?: unknown, token = ze()) =>
    t.api('POST', `/api/delivery/deliveries/${id}/own-fleet/${action}`, { token, ...(body ? { body } : {}) })

  it('pedido até DELIVERED: saiu para entrega, PIN do cliente, pedido COMPLETED e PIN NULL', async () => {
    await setFleet(true)
    try {
      const orderId = await readyOrder()
      const created = await callCourier(orderId)
      assert.equal(created.status, 201)
      assert.equal(created.body.offered, 0)
      assert.equal(created.body.delivery.status, 'REQUESTED')
      const id = created.body.delivery.id as string

      // Antes de sair não dá para confirmar.
      assert.equal((await own(id, 'deliver', { pin: created.body.delivery.pinCode })).status, 409)
      const picked = await own(id, 'pickup')
      assert.equal(picked.status, 200, JSON.stringify(picked.body))
      assert.equal(picked.body.status, 'PICKED_UP')
      assert.equal((await own(id, 'pickup')).status, 409)

      const listed = (await t.api('GET', '/api/delivery/orders', { token: ze() })).body.find((r: { orderId: string }) => r.orderId === orderId)
      assert.equal(listed.ownFleet, true)

      const pin = (await t.api('GET', `/api/delivery/orders/${orderId}`, { token: maria() })).body.delivery.pinCode as string
      const customerSocket = await t.socketFor(MARIA)
      try {
        const ev = nextEvent<{ id: string; status: string }>(customerSocket, 'order:status_updated')
        const done = await own(id, 'deliver', { pin })
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.equal(done.body.status, 'DELIVERED')
        assert.equal((await ev)?.status, 'COMPLETED')
      } finally {
        customerSocket.close()
      }
      assert.equal((await pinOf(id)).pin_code, null)
      assert.equal((await pinOf(id)).status, 'DELIVERED')
      const order = (await t.db.query('SELECT status FROM orders WHERE id = $1', [orderId])).rows[0]
      assert.equal(order.status, 'COMPLETED')
    } finally {
      await setFleet(false)
    }
  })

  it('PIN errado conta tentativas, a 5ª trava (423), o lojista libera e conclui; marcar falha apaga o PIN', async () => {
    await setFleet(true)
    try {
      const orderId = await readyOrder()
      const d = (await callCourier(orderId)).body.delivery
      await own(d.id, 'pickup')
      const wrong = d.pinCode === '0000' ? '1111' : '0000'
      assert.equal((await own(d.id, 'deliver', { pin: '12' })).status, 400)
      for (let i = 1; i <= 4; i++) {
        const res = await own(d.id, 'deliver', { pin: wrong })
        assert.equal(res.status, 422)
        assert.equal(res.body.error.code, 'PIN_INVALID')
        assert.equal(res.body.error.details.attemptsLeft, 5 - i)
        assert.equal((await pinOf(d.id)).pin_attempts, i)
      }
      const fifth = await own(d.id, 'deliver', { pin: wrong })
      assert.equal(fifth.status, 423)
      assert.equal(fifth.body.error.code, 'PIN_LOCKED')
      assert.equal((await own(d.id, 'deliver', { pin: d.pinCode })).status, 423, 'travada: nem o PIN certo passa')

      const unlocked = await t.api('POST', `/api/delivery/deliveries/${d.id}/unlock-pin`, { token: ze() })
      assert.equal(unlocked.status, 200)
      assert.equal(unlocked.body.pinAttempts, 0)
      const pin = (await pinOf(d.id)).pin_code as string
      assert.equal((await own(d.id, 'deliver', { pin })).status, 200)
      assert.equal((await pinOf(d.id)).pin_code, null)

      // Falha: PIN apagado e pedido segue pronto.
      const o2 = await readyOrder()
      const d2 = (await callCourier(o2)).body.delivery
      assert.equal((await own(d2.id, 'fail', { reason: '' })).status, 400)
      const failed = await own(d2.id, 'fail', { reason: 'Cliente ausente' })
      assert.equal(failed.status, 200, JSON.stringify(failed.body))
      assert.equal(failed.body.status, 'FAILED')
      assert.equal((await pinOf(d2.id)).pin_code, null)
      assert.equal((await own(d2.id, 'fail', { reason: 'de novo' })).status, 409)
    } finally {
      await setFleet(false)
    }
  })

  it('recusa entrega do pool (409 NOT_OWN_FLEET) e entrega de outro lojista (404)', async () => {
    // Pool: a entrega é do pool mesmo sem ninguém aceitar.
    const poolOrder = await readyOrder()
    const pool = (await callCourier(poolOrder)).body.delivery
    for (const action of ['pickup', 'deliver', 'fail'] as const) {
      const res = await own(pool.id, action, action === 'deliver' ? { pin: pool.pinCode } : action === 'fail' ? { reason: 'x' } : undefined)
      assert.equal(res.status, 409, action)
      assert.equal(res.body.error.code, 'NOT_OWN_FLEET')
    }
    // Já com entregador: mesmo com a loja em frota própria, a corrida do pool não é do lojista.
    // Atribuição direta no banco: o aceite pela API depende de o entregador estar livre (testes anteriores o ocupam).
    await t.db.query(`UPDATE deliveries SET courier_id = $2, status = 'ACCEPTED' WHERE id = $1`, [pool.id, couriers[5]!.id])
    await setFleet(true)
    try {
      assert.equal((await own(pool.id, 'pickup')).body.error.code, 'NOT_OWN_FLEET')
      // Entrega de frota própria do Zé: outro lojista e cliente não alcançam.
      const o = await readyOrder()
      const d = (await callCourier(o)).body.delivery
      assert.equal((await own(d.id, 'pickup', undefined, lucia())).status, 404)
      assert.equal((await own(d.id, 'deliver', { pin: d.pinCode }, lucia())).status, 404)
      assert.equal((await own(d.id, 'fail', { reason: 'x' }, lucia())).status, 404)
      assert.equal((await own(d.id, 'pickup', undefined, maria())).status, 403)
      assert.equal((await pinOf(d.id)).status, 'REQUESTED')
    } finally {
      await setFleet(false)
    }
    await t.db.query(`UPDATE deliveries SET status = 'FAILED', pin_code = NULL WHERE id = $1`, [pool.id])
  })
})
