import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { AnalyticsDashboard } from '../src/modules/analytics/analytics.types.js'
import { CREME, IOGURTE, LUCIA, MARIA, PAO, startTestEnv, tokenFor, ZE, type TestEnv } from './helpers.js'

let t: TestEnv
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

// Horários em Fortaleza (-03). Período atual: 10 a 12/03/2026. Anterior (3 dias antes): 07 a 09/03/2026.
async function seed() {
  await order('2026-03-10 12:30:00-03', 'COMPLETED', 'pix', [{ productId: CREME, quantity: 100, unitPrice: 4.29 }]) // 429,00
  await order('2026-03-10 12:45:00-03', 'READY', 'card', [{ productId: PAO, quantity: 5, unitPrice: 8.9 }, { productId: IOGURTE, quantity: 2, unitPrice: 3.89 }]) // 52,28
  await order('2026-03-11 19:10:00-03', 'PENDING', null, [{ productId: IOGURTE, quantity: 1, unitPrice: 3.89 }], 'POS') // 3,89
  await order('2026-03-12 12:10:00-03', 'CANCELLED', 'pix', [{ productId: CREME, quantity: 1, unitPrice: 4.29 }]) // cancelado
  await order('2026-03-08 10:00:00-03', 'COMPLETED', 'pix', [{ productId: CREME, quantity: 10, unitPrice: 4.29 }]) // período anterior: 42,90
  // Outra loja: nunca pode aparecer no painel do Zé.
  await order('2026-03-10 12:00:00-03', 'COMPLETED', 'cash', [{ productId: CREME, quantity: 1, unitPrice: 4.29 }], 'ONLINE', LUCIA)

  // Encarte do Zé: 3 ofertas lidas, 2 viraram cupom (1 já retirado).
  const src = (await t.db.query(`INSERT INTO deal_sources (chain_id, url, kind) VALUES (1, 'flyer:test', 'FLYER') RETURNING id`)).rows[0].id
  await t.db.query(`INSERT INTO flyer_uploads (chain_id, uploader_id, source_id, media_type, size_bytes, status, items_extracted, created_at)
                    VALUES (1, $1, $2, 'image/png', 1000, 'SUCCESS', 3, '2026-03-11 09:00:00-03')`, [ZE, src])
  const deals: string[] = []
  for (const name of ['Leite', 'Arroz', 'Feijão']) {
    const r = await t.db.query(
      `INSERT INTO deals (chain_id, source_id, product_name, category, unit, discount_price, first_seen_at, last_seen_at)
       VALUES (1, $1, $2, 'Mercearia', 'un', 5, '2026-03-11 09:00:00-03', '2026-03-11 09:00:00-03') RETURNING id`,
      [src, name],
    )
    deals.push(r.rows[0].id)
  }
  await t.db.query(`INSERT INTO deal_coupons (code, deal_id, customer_id, product_name, unit_price, status, created_at, expires_at, redeemed_at)
                    VALUES ('AAAA000001', $1, $2, 'Leite', 5, 'REDEEMED', '2026-03-11 10:00:00-03', '2026-03-12 10:00:00-03', '2026-03-11 11:00:00-03')`, [deals[0], MARIA])
  await t.db.query(`INSERT INTO deal_coupons (code, deal_id, customer_id, product_name, unit_price, status, created_at, expires_at)
                    VALUES ('AAAA000002', $1, $2, 'Arroz', 5, 'ACTIVE', '2026-03-11 10:30:00-03', '2026-03-12 10:30:00-03')`, [deals[1], MARIA])
}

const get = (qs: string, token = tokenFor(ZE)) => t.api('GET', `/api/v1/analytics/dashboard${qs}`, { token })
const CURRENT = '?startDate=2026-03-10&endDate=2026-03-12'

describe('GET /analytics/dashboard', () => {
  it('só comerciante acessa', async () => {
    assert.equal((await t.api('GET', '/api/v1/analytics/dashboard')).status, 401)
    assert.equal((await get(CURRENT, tokenFor(MARIA))).status, 403)
  })

  it('KPIs do período com comparação ao período anterior, sem cancelados nem pedidos de outra loja', async () => {
    const res = await get(CURRENT)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const d = res.body as AnalyticsDashboard
    assert.deepEqual(d.range, {
      startDate: '2026-03-10', endDate: '2026-03-12', previousStartDate: '2026-03-07', previousEndDate: '2026-03-09',
      days: 3, timezone: 'America/Fortaleza', statuses: ['PENDING', 'IN_PREPARATION', 'READY', 'COMPLETED'],
    })
    assert.deepEqual(d.kpis.revenue, { value: 485.17, previous: 42.9, changePct: 1030.9 })
    assert.deepEqual(d.kpis.orders, { value: 3, previous: 1, changePct: 200 })
    assert.equal(d.kpis.averageTicket.value, 161.72)
    assert.equal(d.kpis.averageTicket.previous, 42.9)
  })

  it('conversão dos encartes: ofertas extraídas → cupons', async () => {
    const f = ((await get(CURRENT)).body as AnalyticsDashboard).kpis.flyerConversion
    assert.equal(f.flyers, 1)
    assert.equal(f.offersExtracted, 3)
    assert.equal(f.offersWithCoupon, 2)
    assert.equal(f.couponsRedeemed, 1)
    assert.equal(f.value, 66.67)
    assert.equal(f.previous, 0)
    assert.equal(f.changePct, null) // sem base de comparação
  })

  it('vendas por hora (24 posições, horário de Fortaleza) e horário de pico', async () => {
    const d = (await get(CURRENT)).body as AnalyticsDashboard
    assert.equal(d.hourly.length, 24)
    assert.deepEqual(d.hourly[12], { hour: 12, label: '12h', orders: 2, revenue: 481.28 })
    assert.deepEqual(d.hourly[19], { hour: 19, label: '19h', orders: 1, revenue: 3.89 })
    assert.equal(d.hourly[3]!.orders, 0)
    assert.equal(d.peak?.hour, 12)
  })

  it('curva ABC: A cobre até 80 %, B até 95 %, C o resto', async () => {
    const abc = ((await get(CURRENT)).body as AnalyticsDashboard).abc
    assert.equal(abc.totalProducts, 3)
    assert.equal(abc.totalRevenue, 485.17)
    assert.deepEqual(abc.items.map((i) => [i.rank, i.productId, i.class]), [[1, CREME, 'A'], [2, PAO, 'B'], [3, IOGURTE, 'C']])
    assert.equal(abc.items[0]!.revenue, 429)
    assert.equal(abc.items[0]!.quantity, 100)
    assert.equal(abc.items[2]!.cumulativeShare, 1)
    assert.deepEqual(abc.classes.map((c) => [c.class, c.products]), [['A', 1], ['B', 1], ['C', 1]])
  })

  it('métodos de pagamento com participação; venda sem método = "Não informado"', async () => {
    const p = ((await get(CURRENT)).body as AnalyticsDashboard).payments
    assert.deepEqual(p.map((x) => [x.method, x.label, x.orders, x.revenue]), [
      ['pix', 'Pix', 1, 429],
      ['card', 'Cartão', 1, 52.28],
      ['unknown', 'Não informado', 1, 3.89],
    ])
    assert.equal(Math.round(p.reduce((s, x) => s + x.share, 0) * 100) / 100, 1)
  })

  it('filtro de status', async () => {
    assert.equal(((await get(`${CURRENT}&status=all`)).body as AnalyticsDashboard).kpis.orders.value, 4)
    assert.equal(((await get(`${CURRENT}&status=CANCELLED`)).body as AnalyticsDashboard).kpis.orders.value, 1)
    assert.equal(((await get(`${CURRENT}&status=completed,ready`)).body as AnalyticsDashboard).kpis.orders.value, 2)
    assert.equal((await get(`${CURRENT}&status=NOPE`)).status, 400)
  })

  it('período sem vendas devolve zeros (não erro)', async () => {
    const d = (await get('?startDate=2025-01-01&endDate=2025-01-07')).body as AnalyticsDashboard
    assert.equal(d.kpis.revenue.value, 0)
    assert.equal(d.kpis.revenue.changePct, 0)
    assert.equal(d.kpis.flyerConversion.value, 0)
    assert.equal(d.peak, null)
    assert.deepEqual(d.abc.items, [])
    assert.deepEqual(d.payments, [])
    assert.equal(d.hourly.length, 24)
  })

  it('valida o intervalo', async () => {
    assert.equal((await get('?startDate=2026-03-12&endDate=2026-03-10')).status, 422)
    assert.equal((await get('?startDate=2020-01-01&endDate=2026-03-10')).status, 422)
    assert.equal((await get('?startDate=ontem&endDate=hoje')).status, 400)
    assert.equal((await get('')).status, 200) // padrão: últimos 7 dias
  })
})
