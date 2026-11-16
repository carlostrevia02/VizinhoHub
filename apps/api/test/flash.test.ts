// Tá Quentinho: ofertas relâmpago (criação, painel, radar, cancelamento, alertas, compra e expiração).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { CREME, IOGURTE, ARROZ_LUCIA, LUCIA, MARIA, PAO, ZE, startTestEnv, tokenFor, type TestEnv } from './helpers.js'

let t: TestEnv
const ze = () => tokenFor(ZE)
const lucia = () => tokenFor(LUCIA)
const maria = () => tokenFor(MARIA)

// Coordenadas da loja do Zé no seed (Aldeota). A da Lúcia fica a ~400 m.
const ZE_LAT = -3.7371
const ZE_LNG = -38.496

const idsOf = (list: { id: string }[]) => list.map((o) => o.id)
const createOffer = (productId: string, over: Record<string, unknown> = {}, token = ze()) =>
  t.api('POST', '/api/flash', { token, body: { productId, offerPrice: 3.5, qtyTotal: 10, durationMin: 60, ...over } })
const radar = (query = '') => t.api('GET', `/api/flash/radar?lat=${ZE_LAT}&lng=${ZE_LNG}${query}`)
const stockOf = async (id: string) => (await t.db.query('SELECT stock_qty FROM products WHERE id = $1', [id])).rows[0].stock_qty as number
const offerRow = async (id: string) =>
  (await t.db.query(`SELECT status, qty_available, qty_total, ends_at > now() AS live FROM flash_offers WHERE id = $1`, [id])).rows[0]

before(async () => {
  t = await startTestEnv()
})
after(() => t?.stop())

// Oferta criada na primeira parte e reutilizada no painel e no radar.
let cremeOfferId = ''

describe('criação: POST /api/flash', () => {
  it('Zé cria oferta de produto próprio com estoque: 201 e DTO completo', async () => {
    const res = await createOffer(CREME)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const o = res.body
    cremeOfferId = o.id
    assert.match(o.id, /^[0-9a-f-]{36}$/)
    assert.equal(o.productId, CREME)
    assert.equal(o.productName, 'Creme de Leite Nestlé 200g')
    assert.equal(o.originalPrice, 4.29, 'preço original = preço efetivo do produto')
    assert.equal(o.offerPrice, 3.5)
    assert.equal(o.qtyTotal, 10)
    assert.equal(o.qtyAvailable, 10)
    assert.equal(o.sold, 0)
    assert.equal(o.maxPerCustomer, 2, 'padrão do schema')
    assert.equal(o.radiusM, 2000, 'padrão do schema')
    assert.equal(o.reason, 'MANUAL', 'padrão do schema')
    assert.equal(o.status, 'ACTIVE')
    const minutesLeft = (new Date(o.endsAt).getTime() - Date.now()) / 60_000
    assert.ok(minutesLeft > 55 && minutesLeft <= 60, `prazo de ~60 min, veio ${minutesLeft.toFixed(1)}`)
  })

  it('validações: 3 casas decimais e durationMin < 5 → 400; preço não menor que o atual → 422', async () => {
    const decimals = await createOffer(PAO, { offerPrice: 3.555 })
    assert.equal(decimals.status, 400)
    assert.equal(decimals.body.error.code, 'VALIDATION_ERROR')

    const short = await createOffer(PAO, { durationMin: 4 })
    assert.equal(short.status, 400)

    const notCheaper = await createOffer(PAO, { offerPrice: 4.45 }) // PAO já está com 50% OFF: efetivo 4,45
    assert.equal(notCheaper.status, 422)
    assert.equal(notCheaper.body.error.code, 'OFFER_NOT_CHEAPER')
  })

  it('produto de outra loja (Lúcia) → 404 PRODUCT_NOT_FOUND, sem criar nada', async () => {
    const res = await createOffer(ARROZ_LUCIA)
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'PRODUCT_NOT_FOUND')
  })

  it('segunda oferta viva para o mesmo produto → 409; sem token → 401; cliente → 403', async () => {
    const dup = await createOffer(CREME)
    assert.equal(dup.status, 409)
    assert.equal(dup.body.error.code, 'FLASH_ALREADY_LIVE')

    assert.equal((await t.api('POST', '/api/flash', { body: { productId: PAO, offerPrice: 3.5, qtyTotal: 1, durationMin: 60 } })).status, 401)
    assert.equal((await createOffer(PAO, {}, maria())).status, 403)
  })
})

describe('painel do lojista: GET /api/flash/mine', () => {
  it('o Zé vê a oferta dele; a Lúcia não', async () => {
    const mine = await t.api('GET', '/api/flash/mine', { token: ze() })
    assert.equal(mine.status, 200)
    assert.ok(idsOf(mine.body).includes(cremeOfferId))

    const theirs = await t.api('GET', '/api/flash/mine', { token: lucia() })
    assert.equal(theirs.status, 200)
    assert.ok(!idsOf(theirs.body).includes(cremeOfferId))
  })

  it('cliente → 403; sem token → 401', async () => {
    assert.equal((await t.api('GET', '/api/flash/mine', { token: maria() })).status, 403)
    assert.equal((await t.api('GET', '/api/flash/mine')).status, 401)
  })
})

describe('radar: GET /api/flash/radar (público)', () => {
  it('perto da loja do Zé a oferta aparece com preço, desconto, loja e distância', async () => {
    const res = await radar()
    assert.equal(res.status, 200)
    const offer = res.body.find((o: { id: string }) => o.id === cremeOfferId)
    assert.ok(offer, 'a oferta deveria aparecer no radar')
    assert.equal(offer.offerPrice, 3.5)
    assert.equal(offer.originalPrice, 4.29)
    assert.equal(offer.discountPct, 18)
    assert.equal(offer.storeName, 'Mercadinho do Zé')
    assert.equal(offer.qtyAvailable, 10)
    assert.ok(offer.distanceM <= 5, `distância ${offer.distanceM}`)
    assert.equal(offer.radiusM, undefined, 'o raio é interno, não vai para o cliente')
  })

  it('longe (0, 0) não aparece; lat 200 → 400', async () => {
    const far = await t.api('GET', '/api/flash/radar?lat=0&lng=0')
    assert.equal(far.status, 200)
    assert.ok(!idsOf(far.body).includes(cremeOfferId))

    const bad = await t.api('GET', '/api/flash/radar?lat=200&lng=' + ZE_LNG)
    assert.equal(bad.status, 400)
  })

  it('filtro de categoria: CREME é da categoria 2 (Frios), não da 1 (Mercearia)', async () => {
    assert.ok(idsOf((await radar('&category=2')).body).includes(cremeOfferId))
    assert.ok(!idsOf((await radar('&category=1')).body).includes(cremeOfferId))
  })
})

describe('cancelamento: POST /api/flash/:id/cancel', () => {
  let iogurteOfferId = ''

  before(async () => {
    const res = await createOffer(IOGURTE, { offerPrice: 2, qtyTotal: 12 })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    iogurteOfferId = res.body.id
  })

  it('a Lúcia não consegue cancelar a oferta do Zé (404) e ela continua no radar', async () => {
    const res = await t.api('POST', `/api/flash/${iogurteOfferId}/cancel`, { token: lucia() })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'FLASH_NOT_FOUND')
    assert.ok(idsOf((await radar()).body).includes(iogurteOfferId))
  })

  it('o dono cancela (204): some do radar e volta como CANCELLED; cancelar de novo → 404', async () => {
    assert.equal((await t.api('POST', `/api/flash/${iogurteOfferId}/cancel`, { token: ze() })).status, 204)
    assert.ok(!idsOf((await radar()).body).includes(iogurteOfferId))
    const mine = await t.api('GET', '/api/flash/mine', { token: ze() })
    assert.equal(mine.body.find((o: { id: string }) => o.id === iogurteOfferId).status, 'CANCELLED')
    assert.equal((await t.api('POST', `/api/flash/${iogurteOfferId}/cancel`, { token: ze() })).status, 404)
  })

  it('cliente → 403; sem token → 401', async () => {
    assert.equal((await t.api('POST', `/api/flash/${cremeOfferId}/cancel`, { token: maria() })).status, 403)
    assert.equal((await t.api('POST', `/api/flash/${cremeOfferId}/cancel`)).status, 401)
  })
})

describe('alertas "perto de casa": /api/me/alerts', () => {
  let alertId = ''

  it('sem login → 401 em listar e criar', async () => {
    assert.equal((await t.api('GET', '/api/me/alerts')).status, 401)
    assert.equal((await t.api('POST', '/api/me/alerts', { body: { latitude: ZE_LAT, longitude: ZE_LNG } })).status, 401)
  })

  it('criar (201), listar com os campos gravados e remover (204)', async () => {
    const created = await t.api('POST', '/api/me/alerts', {
      token: maria(),
      body: { label: 'Casa', latitude: ZE_LAT, longitude: ZE_LNG, radiusM: 1500, categoryIds: [2], quietFrom: '22:00', quietTo: '07:00' },
    })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    alertId = created.body.id
    assert.ok(alertId)

    const list = await t.api('GET', '/api/me/alerts', { token: maria() })
    assert.equal(list.status, 200)
    const alert = list.body.find((a: { id: string }) => a.id === alertId)
    assert.ok(alert, 'o alerta deveria aparecer na listagem')
    assert.equal(alert.label, 'Casa')
    assert.equal(alert.radiusM, 1500)
    assert.deepEqual(alert.categoryIds, [2])
    assert.equal(alert.quietFrom, '22:00')
    assert.equal(alert.quietTo, '07:00')
    assert.equal(alert.active, true)

    assert.equal((await t.api('DELETE', `/api/me/alerts/${alertId}`, { token: maria() })).status, 204)
    assert.ok(!idsOf((await t.api('GET', '/api/me/alerts', { token: maria() })).body).includes(alertId))
    assert.equal((await t.api('DELETE', `/api/me/alerts/${alertId}`, { token: maria() })).status, 404)
  })

  it('"não perturbe" só com início (sem fim) → 400', async () => {
    const res = await t.api('POST', '/api/me/alerts', { token: maria(), body: { latitude: ZE_LAT, longitude: ZE_LNG, quietFrom: '22:00' } })
    assert.equal(res.status, 400)
  })
})

describe('compra com oferta relâmpago: POST /api/orders { items: [{ flashOfferId, quantity }] }', () => {
  let paoOfferId = ''
  let soldOut = { offerId: '', orderId: '' }

  before(async () => {
    // PAO tem 5 em estoque; a oferta vende 3 e cada cliente pode levar no máximo 2.
    const res = await createOffer(PAO, { offerPrice: 2, qtyTotal: 3, maxPerCustomer: 2 })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    paoOfferId = res.body.id
  })

  it('Maria leva 2 → 201 com unitPrice = preço da oferta; saldo cai para 1', async () => {
    const res = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ flashOfferId: paoOfferId, quantity: 2 }] } })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.items[0].unitPrice, 2)
    assert.equal(res.body.items[0].quantity, 2)
    assert.equal((await offerRow(paoOfferId)).qty_available, 1)
  })

  it('Maria tenta mais 1 → recusa por limite por cliente; o saldo não muda', async () => {
    const res = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ flashOfferId: paoOfferId, quantity: 1 }] } })
    assert.equal(res.status, 422, JSON.stringify(res.body))
    assert.equal(res.body.error.code, 'FLASH_LIMIT')
    assert.equal((await offerRow(paoOfferId)).qty_available, 1)
    const { rows } = await t.db.query('SELECT qty FROM flash_offer_claims WHERE offer_id = $1 AND customer_id = $2', [paoOfferId, MARIA])
    assert.equal(rows[0].qty, 2)
  })

  it('concorrência: oferta com 2 unidades e 5 pedidos simultâneos de clientes diferentes → exatamente 2 vendas', async () => {
    assert.equal((await t.api('POST', `/api/flash/${paoOfferId}/cancel`, { token: ze() })).status, 204)
    const fresh = await createOffer(PAO, { offerPrice: 2, qtyTotal: 2, maxPerCustomer: 2 })
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body))
    const offerId = fresh.body.id

    const tokens: string[] = []
    for (let i = 1; i <= 5; i++) {
      const reg = await t.api('POST', '/api/auth/register', { body: { name: `Cliente Teste ${i}`, email: `concorrente${i}@teste.test`, password: 'senha-forte-123' } })
      assert.equal(reg.status, 201, JSON.stringify(reg.body))
      tokens.push(reg.body.token)
    }

    const results = await Promise.all(tokens.map((token) => t.api('POST', '/api/orders', { token, body: { items: [{ flashOfferId: offerId, quantity: 1 }] } })))
    const statuses = results.map((r) => r.status).sort()
    assert.deepEqual(statuses, [201, 201, 422, 422, 422], JSON.stringify(statuses))
    for (const r of results.filter((x) => x.status === 422)) assert.equal(r.body.error.code, 'FLASH_UNAVAILABLE')

    const row = await offerRow(offerId)
    assert.equal(row.qty_available, 0, 'saldo zerado no banco')
    assert.equal(row.status, 'SOLD_OUT')
    const { rows } = await t.db.query('SELECT coalesce(sum(qty), 0)::int AS total FROM flash_offer_claims WHERE offer_id = $1', [offerId])
    assert.equal(rows[0].total, 2)
    soldOut = { offerId, orderId: results.find((r) => r.status === 201)!.body.id }
  })

  it('cancelar um pedido devolve o saldo da oferta e o limite do cliente (SOLD_OUT volta a ACTIVE)', async () => {
    const res = await t.api('PATCH', `/api/orders/${soldOut.orderId}/status`, { token: ze(), body: { status: 'CANCELLED' } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const row = await offerRow(soldOut.offerId)
    assert.equal(row.qty_available, 1)
    assert.equal(row.status, 'ACTIVE')
    const { rows } = await t.db.query('SELECT coalesce(sum(qty), 0)::int AS total FROM flash_offer_claims WHERE offer_id = $1', [soldOut.offerId])
    assert.equal(rows[0].total, 1)
  })

  it('o mesmo produto ao preço normal e em oferta no mesmo pedido → 422 FLASH_PRODUCT_CONFLICT, sem baixar nada', async () => {
    const res = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: PAO, quantity: 1 }, { flashOfferId: soldOut.offerId, quantity: 1 }] } })
    assert.equal(res.status, 422, JSON.stringify(res.body))
    assert.equal(res.body.error.code, 'FLASH_PRODUCT_CONFLICT')
    assert.equal((await offerRow(soldOut.offerId)).qty_available, 1, 'o ROLLBACK devolve a baixa da oferta')
  })
})

describe('expiração', () => {
  it('oferta com prazo vencido não aparece no radar (e o painel passa a mostrar ENDED)', async () => {
    const res = await createOffer(IOGURTE, { offerPrice: 2, qtyTotal: 5, durationMin: 30 })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const offerId = res.body.id
    assert.ok(idsOf((await radar()).body).includes(offerId), 'antes de vencer, aparece')

    await t.db.query(`UPDATE flash_offers SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute' WHERE id = $1`, [offerId])
    assert.ok(!idsOf((await radar()).body).includes(offerId), 'vencida: some do radar')

    const mine = await t.api('GET', '/api/flash/mine', { token: ze() })
    assert.equal(mine.body.find((o: { id: string }) => o.id === offerId).status, 'ENDED')
  })
})
