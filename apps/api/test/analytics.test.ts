import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { AnalyticsDashboard } from '../src/modules/analytics/analytics.types.js'
import { CREME, IOGURTE, LUCIA, MARIA, PAO, startTestEnv, tokenFor, ZE, type TestEnv } from './helpers.js'

let t: TestEnv
let ANA = '' // cliente que só compra por cupom
before(async () => {
  t = await startTestEnv()
  await seed()
})
after(() => t?.stop())

interface Line { productId: string; quantity: number; unitPrice: number }
async function order(at: string, status: string, payment: string | null, lines: Line[], channel: 'ONLINE' | 'POS' = 'ONLINE', merchant = ZE) {
  const total = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * 100), 0) / 100
  const { rows } = await t.db.query(
    `INSERT INTO orders (customer_id, merchant_id, channel, total_price, status, payment_method, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [channel === 'POS' ? null : MARIA, merchant, channel, total, status, payment, at],
  )
  for (const l of lines) {
    await t.db.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)', [rows[0].id, l.productId, l.quantity, l.unitPrice])
  }
}

async function source(chainId: number, url: string, uploader: string, status: string): Promise<{ sourceId: number; dealIds: Record<string, string> }> {
  const src = (await t.db.query(`INSERT INTO deal_sources (chain_id, url, kind) VALUES ($1, $2, 'FLYER') RETURNING id`, [chainId, url])).rows[0].id
  await t.db.query(
    `INSERT INTO flyer_uploads (chain_id, uploader_id, source_id, media_type, size_bytes, status, items_extracted, created_at)
     VALUES ($1, $2, $3, 'image/png', 1000, $4, 3, '2026-03-11 09:00:00-03')`,
    [chainId, uploader, src, status],
  )
  const dealIds: Record<string, string> = {}
  for (const name of ['Leite', 'Arroz', 'Feijão']) {
    const r = await t.db.query(
      `INSERT INTO deals (chain_id, source_id, product_name, category, unit, discount_price, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, 'Mercearia', 'un', 5, '2026-03-11 09:00:00-03', '2026-03-11 09:00:00-03') RETURNING id`,
      [chainId, src, name],
    )
    dealIds[name] = r.rows[0].id
  }
  return { sourceId: src, dealIds }
}

interface CouponOpts { unit: number; orig: number; min?: number; created: string; redeemed?: string }
async function coupon(code: string, dealId: string, customer: string, status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED', o: CouponOpts) {
  await t.db.query(
    `INSERT INTO deal_coupons (code, deal_id, customer_id, product_name, unit_price, original_price, min_qty, status, created_at, expires_at, redeemed_at)
     VALUES ($1, $2, $3, 'oferta', $4, $5, $6, $7, $8, $8::timestamptz + interval '1 day', $9)`,
    [code, dealId, customer, o.unit, o.orig, o.min ?? 1, status, o.created, o.redeemed ?? null],
  )
}

// Horários em Fortaleza (-03). Período atual: 10 a 12/03/2026. Anterior (3 dias antes): 07 a 09/03/2026.
async function seed() {
  ANA = (await t.db.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Ana Lima', 'ana@vizinhohub.test', 'x', 'CUSTOMER') RETURNING id`)).rows[0].id

  await order('2026-03-10 12:30:00-03', 'COMPLETED', 'pix', [{ productId: CREME, quantity: 100, unitPrice: 4.29 }]) // 429,00
  await order('2026-03-10 12:45:00-03', 'READY', 'card', [{ productId: PAO, quantity: 5, unitPrice: 8.9 }, { productId: IOGURTE, quantity: 2, unitPrice: 3.89 }]) // 52,28
  await order('2026-03-11 19:10:00-03', 'PENDING', null, [{ productId: IOGURTE, quantity: 1, unitPrice: 3.89 }], 'POS') // 3,89
  await order('2026-03-12 12:10:00-03', 'CANCELLED', 'pix', [{ productId: CREME, quantity: 1, unitPrice: 4.29 }]) // cancelado
  await order('2026-03-08 10:00:00-03', 'COMPLETED', 'pix', [{ productId: CREME, quantity: 10, unitPrice: 4.29 }]) // período anterior: 42,90
  // Outra loja: nunca pode aparecer no painel do Zé.
  await order('2026-03-10 12:00:00-03', 'COMPLETED', 'cash', [{ productId: CREME, quantity: 1, unitPrice: 4.29 }], 'ONLINE', LUCIA)

  // Encarte do Zé (enviado em 11/03): 3 ofertas lidas, todas viraram cupom, 2 foram compradas (cupom confirmado).
  const ze = await source(1, 'flyer:ze', ZE, 'SUCCESS')
  // Cupons do Zé. Valor = unit * min; lucro = (orig - unit) * min.
  await coupon('AAAA000001', ze.dealIds.Leite!, MARIA, 'REDEEMED', { unit: 5, orig: 7, created: '2026-03-11 10:00:00-03', redeemed: '2026-03-11 11:00:00-03' }) // 5,00 · lucro 2,00 · 11h
  await coupon('AAAA000002', ze.dealIds.Arroz!, MARIA, 'ACTIVE', { unit: 5, orig: 8, created: '2026-03-11 10:30:00-03' }) // emitido, não confirmado: NÃO é venda
  await coupon('AAAA000003', ze.dealIds.Arroz!, MARIA, 'EXPIRED', { unit: 5, orig: 8, created: '2026-03-10 08:00:00-03' }) // venceu: NÃO é venda
  await coupon('AAAA000004', ze.dealIds.Feijão!, ANA, 'REDEEMED', { unit: 6.5, orig: 9, min: 3, created: '2026-03-12 12:00:00-03', redeemed: '2026-03-12 12:20:00-03' }) // 19,50 · lucro 7,50 · 12h
  await coupon('AAAA000005', ze.dealIds.Leite!, MARIA, 'REDEEMED', { unit: 5, orig: 6, min: 2, created: '2026-03-09 14:00:00-03', redeemed: '2026-03-09 15:00:00-03' }) // período anterior: 10,00 · lucro 2,00
  await coupon('AAAA000006', ze.dealIds.Leite!, ANA, 'REDEEMED', { unit: 5, orig: 7, created: '2026-03-12 20:00:00-03', redeemed: '2026-03-13 00:00:00-03' }) // 1 s fora do fim do período
  await coupon('AAAA000008', ze.dealIds.Leite!, ANA, 'REDEEMED', { unit: 5, orig: 7, created: '2026-03-20 13:00:00-03', redeemed: '2026-03-20 14:00:00-03' }) // 5,00 · lucro 2,00 · bem depois do envio do encarte
  await coupon('AAAA000010', ze.dealIds.Leite!, ANA, 'REDEEMED', { unit: 5, orig: 7, min: 2, created: '2026-03-09 23:00:00-03', redeemed: '2026-03-10 00:00:00-03' }) // 10,00 · lucro 4,00 · 0h (início do período)

  // Fonte de OUTRO comerciante (Lúcia): nunca conta para o Zé.
  const lucia = await source(2, 'flyer:lucia', LUCIA, 'SUCCESS')
  await coupon('AAAA000007', lucia.dealIds.Leite!, MARIA, 'REDEEMED', { unit: 100, orig: 150, created: '2026-03-11 09:30:00-03', redeemed: '2026-03-11 10:00:00-03' }) // 100,00 · lucro 50,00
  // Encarte do Zé que falhou: a fonte não é dele.
  const falhou = await source(3, 'flyer:ze-falhou', ZE, 'FAILED')
  await coupon('AAAA000009', falhou.dealIds.Leite!, MARIA, 'REDEEMED', { unit: 50, orig: 60, created: '2026-03-11 09:30:00-03', redeemed: '2026-03-11 10:00:00-03' })

  // Visitas à vitrine do Zé no período atual (10 sessões).
  for (let i = 0; i < 10; i++) {
    await t.db.query(`INSERT INTO store_events (merchant_id, session_id, type, created_at) VALUES ($1, $2, 'STORE_VIEW', '2026-03-10 08:00:00-03')`, [ZE, randomUUID()])
  }
}

const get = (qs: string, token = tokenFor(ZE)) => t.api('GET', `/api/v1/analytics/dashboard${qs}`, { token })
const dash = async (qs: string, token = tokenFor(ZE)) => (await get(qs, token)).body as AnalyticsDashboard
const CURRENT = '?startDate=2026-03-10&endDate=2026-03-12'

describe('GET /analytics/dashboard', () => {
  it('só comerciante acessa', async () => {
    assert.equal((await t.api('GET', '/api/v1/analytics/dashboard')).status, 401)
    assert.equal((await get(CURRENT, tokenFor(MARIA))).status, 403)
  })

  it('KPIs somam pedidos online e cupons confirmados, com comparação ao período anterior', async () => {
    const res = await get(CURRENT)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const d = res.body as AnalyticsDashboard
    assert.deepEqual(d.range, {
      startDate: '2026-03-10', endDate: '2026-03-12', previousStartDate: '2026-03-07', previousEndDate: '2026-03-09',
      days: 3, timezone: 'America/Fortaleza', statuses: ['PENDING', 'IN_PREPARATION', 'READY', 'COMPLETED'],
    })
    // Atual: pedidos 485,17 (3) + cupons 34,50 (3: AAAA1, AAAA4, AAAA10) = 519,67 em 6 compras. Anterior: 42,90 (1) + 10,00 (AAAA5) = 52,90 em 2.
    assert.deepEqual(d.kpis.revenue, { value: 519.67, previous: 52.9, changePct: 882.4 })
    assert.deepEqual(d.kpis.orders, { value: 6, previous: 2, changePct: 200 })
    assert.equal(d.kpis.averageTicket.value, 86.61)
    assert.equal(d.kpis.averageTicket.previous, 26.45)
  })

  it('lucro vem só dos cupons confirmados e respeita min_qty > 1', async () => {
    const d = await dash(CURRENT)
    // (7-5)*1 + (9-6,5)*3 + (7-5)*2 = 2 + 7,5 + 4 = 13,5. Anterior: (6-5)*2 = 2.
    assert.deepEqual(d.kpis.profit, { value: 13.5, previous: 2, changePct: 575 })
  })

  it('cupom ACTIVE, EXPIRED, fora do período, de outro comerciante ou de encarte que falhou NÃO conta', async () => {
    // Soma esperada: só AAAA1, AAAA4 e AAAA10 no período. Os demais (AAAA2 ativo, AAAA3 vencido, AAAA6 às 00:00 de 13/03,
    // AAAA7 da Lúcia, AAAA9 de encarte FAILED, AAAA8 de 20/03) ficam de fora.
    const d = await dash(CURRENT)
    assert.equal(d.channels.coupon.orders, 3)
    assert.equal(d.channels.coupon.revenue, 34.5)
    assert.equal(d.kpis.conversion.couponPurchases, 3)
  })

  it('cupom pertence ao comerciante por qualquer encarte dele, sem restringir a data do envio', async () => {
    const d = await dash('?startDate=2026-03-20&endDate=2026-03-20') // o encarte foi enviado em 11/03
    assert.equal(d.kpis.revenue.value, 5)
    assert.equal(d.kpis.orders.value, 1)
    assert.equal(d.kpis.profit.value, 2)
    assert.equal(d.kpis.flyerConversion.flyers, 0) // a conversão dos encartes continua pelo período do envio
  })

  it('divisão por canal do período atual', async () => {
    const d = await dash(CURRENT)
    assert.deepEqual(d.channels, {
      online: { orders: 3, revenue: 485.17 },
      coupon: { orders: 3, revenue: 34.5, profit: 13.5 },
    })
  })

  it('o painel de outro comerciante só enxerga o que é dele (pedido da Lúcia + cupom da fonte dela)', async () => {
    const d = await dash(CURRENT, tokenFor(LUCIA))
    assert.deepEqual(d.channels, { online: { orders: 1, revenue: 4.29 }, coupon: { orders: 1, revenue: 100, profit: 50 } })
    assert.equal(d.kpis.revenue.value, 104.29)
    assert.deepEqual(d.topOffers.map((o) => [o.productName, o.chain.slug, o.profit]), [['Leite', 'atacadao', 50]])
    assert.deepEqual(d.topCustomers.map((c) => [c.name, c.spent]), [['Maria Souza', 104.29]])
  })

  it('conversão dos encartes: ofertas extraídas → ofertas com compra confirmada', async () => {
    const f = (await dash(CURRENT)).kpis.flyerConversion
    assert.equal(f.flyers, 1)
    assert.equal(f.offersExtracted, 3)
    assert.equal(f.offersWithCoupon, 3) // Leite, Arroz e Feijão tiveram cupom emitido
    assert.equal(f.offersWithPurchase, 2) // só Leite e Feijão foram comprados (Arroz: ativo e vencido)
    assert.equal(f.couponsConfirmed, 3)
    assert.equal(f.couponsRedeemed, 3)
    assert.equal(f.value, 66.67)
    assert.equal(f.previous, 0)
    assert.equal(f.changePct, null) // sem base de comparação
  })

  it('conversão da vitrine: compras = pedidos online + cupons confirmados ÷ visitas', async () => {
    const c = (await dash(CURRENT)).kpis.conversion
    assert.equal(c.sessions, 10)
    assert.equal(c.onlineOrders, 2) // o balcão (POS) e o cancelado não entram
    assert.equal(c.couponPurchases, 3)
    assert.equal(c.funnel.orders, 5)
    assert.equal(c.funnel.storeViews, 10)
    assert.equal(c.value, 50)
    assert.equal(c.previous, 0)
  })

  it('vendas por hora (24 posições, horário de Fortaleza) incluem cupom na hora de redeemed_at; horário de pico', async () => {
    const d = await dash(CURRENT)
    assert.equal(d.hourly.length, 24)
    assert.deepEqual(d.hourly[0], { hour: 0, label: '00h', orders: 1, revenue: 10 }) // AAAA10: início exato do período
    assert.deepEqual(d.hourly[11], { hour: 11, label: '11h', orders: 1, revenue: 5 }) // AAAA1
    assert.deepEqual(d.hourly[12], { hour: 12, label: '12h', orders: 3, revenue: 500.78 }) // 2 pedidos + AAAA4
    assert.deepEqual(d.hourly[19], { hour: 19, label: '19h', orders: 1, revenue: 3.89 })
    assert.equal(d.hourly[3]!.orders, 0)
    assert.equal(d.peak?.hour, 12)
  })

  it('curva ABC: só itens de pedido online; A cobre até 80 %, B até 95 %, C o resto', async () => {
    const abc = (await dash(CURRENT)).abc
    assert.equal(abc.totalProducts, 3)
    assert.equal(abc.totalRevenue, 485.17) // cupom não entra
    assert.deepEqual(abc.items.map((i) => [i.rank, i.productId, i.class]), [[1, CREME, 'A'], [2, PAO, 'B'], [3, IOGURTE, 'C']])
    assert.equal(abc.items[0]!.revenue, 429)
    assert.equal(abc.items[0]!.quantity, 100)
    assert.equal(abc.items[2]!.cumulativeShare, 1)
    assert.deepEqual(abc.classes.map((c) => [c.class, c.products]), [['A', 1], ['B', 1], ['C', 1]])
  })

  it('métodos de pagamento com participação; cupom = "Cupom (retirada)"; venda sem método = "Não informado"', async () => {
    const p = (await dash(CURRENT)).payments
    assert.deepEqual(p.map((x) => [x.method, x.label, x.orders, x.revenue]), [
      ['pix', 'Pix', 1, 429],
      ['card', 'Cartão', 1, 52.28],
      ['coupon', 'Cupom (retirada)', 3, 34.5],
      ['unknown', 'Não informado', 1, 3.89],
    ])
    assert.equal(Math.round(p.reduce((s, x) => s + x.share, 0) * 100) / 100, 1)
    assert.equal(p[2]!.share, 0.0664) // 34,5 ÷ 519,67
  })

  it('ofertas mais lucrativas: agrupa por oferta, ordena por lucro', async () => {
    const o = (await dash(CURRENT)).topOffers
    assert.deepEqual(o, [
      { productName: 'Feijão', chain: { slug: 'assai', name: 'Assaí Atacadista' }, purchases: 1, units: 3, revenue: 19.5, profit: 7.5 },
      { productName: 'Leite', chain: { slug: 'assai', name: 'Assaí Atacadista' }, purchases: 2, units: 3, revenue: 15, profit: 6 }, // AAAA1 + AAAA10
    ])
  })

  it('clientes que mais compraram: pedido online + cupom confirmado, por valor gasto', async () => {
    const c = (await dash(CURRENT)).topCustomers
    assert.deepEqual(c, [
      // Maria: 2 pedidos online (481,28; o do balcão não tem cliente) + AAAA1 (5,00, lucro 2,00)
      { customerId: MARIA, name: 'Maria Souza', purchases: 3, spent: 486.28, profit: 2 },
      // Ana: só cupons (AAAA4 + AAAA10)
      { customerId: ANA, name: 'Ana Lima', purchases: 2, spent: 29.5, profit: 11.5 },
    ])
  })

  it('filtro de status vale para pedidos; cupom confirmado é compra confirmada e não depende dele', async () => {
    assert.equal((await dash(`${CURRENT}&status=all`)).kpis.orders.value, 7) // 4 pedidos + 3 cupons
    assert.equal((await dash(`${CURRENT}&status=CANCELLED`)).kpis.orders.value, 4) // 1 cancelado + 3 cupons
    assert.equal((await dash(`${CURRENT}&status=completed,ready`)).kpis.orders.value, 5) // 2 pedidos + 3 cupons
    assert.equal((await get(`${CURRENT}&status=NOPE`)).status, 400)
  })

  it('período sem vendas devolve zeros (não erro)', async () => {
    const d = await dash('?startDate=2025-01-01&endDate=2025-01-07')
    assert.equal(d.kpis.revenue.value, 0)
    assert.equal(d.kpis.revenue.changePct, 0)
    assert.equal(d.kpis.profit.value, 0)
    assert.equal(d.kpis.flyerConversion.value, 0)
    assert.equal(d.kpis.flyerConversion.offersWithPurchase, 0)
    assert.equal(d.kpis.conversion.couponPurchases, 0)
    assert.equal(d.peak, null)
    assert.deepEqual(d.abc.items, [])
    assert.deepEqual(d.payments, [])
    assert.deepEqual(d.channels, { online: { orders: 0, revenue: 0 }, coupon: { orders: 0, revenue: 0, profit: 0 } })
    assert.deepEqual(d.topOffers, [])
    assert.deepEqual(d.topCustomers, [])
    assert.equal(d.hourly.length, 24)
  })

  it('valida o intervalo', async () => {
    assert.equal((await get('?startDate=2026-03-12&endDate=2026-03-10')).status, 422)
    assert.equal((await get('?startDate=2020-01-01&endDate=2026-03-10')).status, 422)
    assert.equal((await get('?startDate=ontem&endDate=hoje')).status, 400)
    assert.equal((await get('')).status, 200) // padrão: últimos 7 dias
  })
})
