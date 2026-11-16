// Encomendas (faixas de retirada), Prato do Dia e Combos.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { LUCIA, MARIA, ZE, startTestEnv, tokenFor, type TestEnv } from './helpers.js'

let t: TestEnv
const ze = () => tokenFor(ZE)
const lucia = () => tokenFor(LUCIA)
const maria = () => tokenFor(MARIA)

const BOLO = 'dddddddd-0000-4000-8000-000000000001' // encomenda (48 h de antecedência), R$ 50
const PRATO = 'dddddddd-0000-4000-8000-000000000002' // prato do dia, R$ 25
const SUCO = 'dddddddd-0000-4000-8000-000000000003' // componente · 10 un
const PAOZ = 'dddddddd-0000-4000-8000-000000000004' // componente · 6 un
const ARROZ_LUCIA = 'bbbbbbbb-0000-4000-8000-000000000001'

// Data (no fuso de Fortaleza, UTC-3) daqui a `days` dias e o dia da semana dela.
function fortalezaDay(days: number) {
  const d = new Date(Date.now() - 3 * 3_600_000 + days * 86_400_000)
  const date = d.toISOString().slice(0, 10)
  return { date, weekday: d.getUTCDay(), at: (hhmm: string) => `${date}T${hhmm}:00-03:00` }
}
const DAY = fortalezaDay(4)

const stock = async (id: string) => (await t.db.query(`SELECT stock_qty FROM products WHERE id = $1`, [id])).rows[0].stock_qty as number
const booked = async (slotId: string) => Number((await t.db.query(`SELECT COALESCE(sum(booked), 0)::int AS n FROM slot_bookings WHERE slot_id = $1`, [slotId])).rows[0].n)
const order = (items: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}, token = maria()) =>
  t.api('POST', '/api/orders', { token, body: { items, ...extra } })
const setStatus = (id: string, status: string) => t.api('PATCH', `/api/orders/${id}/status`, { token: ze(), body: { status } })

before(async () => {
  t = await startTestEnv()
  await t.db.query(
    `INSERT INTO products (id, user_id, category_id, name, price, stock_qty, lead_time_hours) VALUES
       ($1, $5, 4, 'Bolo de aniversário', 50, 100, 48),
       ($2, $5, 1, 'Feijoada do dia', 25, 0, 0),
       ($3, $5, 3, 'Suco de caju', 5, 10, 0),
       ($4, $5, 4, 'Pão de queijo', 4, 6, 0)`,
    [BOLO, PRATO, SUCO, PAOZ, ZE],
  )
})
after(() => t?.stop())

describe('faixas de retirada (lojista)', () => {
  let slotId = ''

  it('cria faixa (09:00–12:00, 3 vagas); cliente → 403; fim antes do início → 400; duplicada → 409', async () => {
    const body = { weekday: DAY.weekday, startsAt: '09:00', endsAt: '12:00', capacity: 3 }
    const res = await t.api('POST', '/api/scheduling/slots', { token: ze(), body })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.deepEqual({ ...res.body, id: undefined, merchantId: undefined }, { weekday: DAY.weekday, startsAt: '09:00', endsAt: '12:00', capacity: 3, active: true, id: undefined, merchantId: undefined })
    slotId = res.body.id
    assert.equal((await t.api('POST', '/api/scheduling/slots', { token: maria(), body })).status, 403)
    assert.equal((await t.api('POST', '/api/scheduling/slots', { token: ze(), body: { ...body, startsAt: '13:00', endsAt: '12:00' } })).status, 400)
    assert.equal((await t.api('POST', '/api/scheduling/slots', { token: ze(), body })).status, 409)
  })

  it('PATCH só muda o que veio (faixa inativa continua inativa); outra loja não mexe (404)', async () => {
    const off = await t.api('POST', '/api/scheduling/slots', { token: ze(), body: { weekday: 0, startsAt: '14:00', endsAt: '15:00', capacity: 1, active: false } })
    const res = await t.api('PATCH', `/api/scheduling/slots/${off.body.id}`, { token: ze(), body: { capacity: 5 } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.capacity, 5)
    assert.equal(res.body.active, false)
    assert.equal((await t.api('PATCH', `/api/scheduling/slots/${slotId}`, { token: lucia(), body: { capacity: 99 } })).status, 404)
    assert.equal((await t.api('DELETE', `/api/scheduling/slots/${off.body.id}`, { token: ze() })).body.result, 'deleted')
    assert.deepEqual((await t.api('GET', '/api/scheduling/slots', { token: lucia() })).body, [])
  })

  it('disponibilidade: vagas livres do dia; exige login', async () => {
    const res = await t.api('GET', `/api/scheduling/availability?merchantId=${ZE}&from=${DAY.date}&days=1`, { token: maria() })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, [{ slotId, date: DAY.date, startsAt: '09:00', endsAt: '12:00', capacity: 3, booked: 0, free: 3 }])
    assert.equal((await t.api('GET', `/api/scheduling/availability?merchantId=${ZE}&from=${DAY.date}`)).status, 401)
  })
})

describe('encomenda: antecedência e agenda', () => {
  let slotId = ''
  before(async () => {
    slotId = (await t.db.query(`SELECT id FROM pickup_slots WHERE merchant_id = $1`, [ZE])).rows[0].id
  })

  it('produto de encomenda sem agendamento → 422 SCHEDULE_REQUIRED', async () => {
    const res = await order([{ productId: BOLO, quantity: 1 }])
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'SCHEDULE_REQUIRED')
    assert.equal(res.body.error.details.leadTimeHours, 48)
  })

  it('antes da antecedência mínima → 422 LEAD_TIME; passado → SCHEDULE_IN_PAST', async () => {
    const soon = new Date(Date.now() + 24 * 3_600_000).toISOString()
    const res = await order([{ productId: BOLO, quantity: 1 }], { schedule: { scheduledFor: soon, slotId } })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'LEAD_TIME')
    const past = await order([{ productId: BOLO, quantity: 1 }], { schedule: { scheduledFor: new Date(Date.now() - 3_600_000).toISOString(), slotId } })
    assert.equal(past.body.error.code, 'SCHEDULE_IN_PAST')
  })

  it('faixa errada: sem faixa → SLOT_REQUIRED; horário fora da faixa → SLOT_MISMATCH; sinal > total → DEPOSIT_TOO_HIGH', async () => {
    const items = [{ productId: BOLO, quantity: 1 }]
    assert.equal((await order(items, { schedule: { scheduledFor: DAY.at('10:00') } })).body.error.code, 'SLOT_REQUIRED')
    assert.equal((await order(items, { schedule: { scheduledFor: DAY.at('14:00'), slotId } })).body.error.code, 'SLOT_MISMATCH')
    assert.equal((await order(items, { schedule: { scheduledFor: DAY.at('12:00'), slotId } })).body.error.code, 'SLOT_MISMATCH', 'o fim da faixa é exclusivo')
    assert.equal((await order(items, { schedule: { scheduledFor: DAY.at('10:00'), slotId, depositAmount: 50.01 } })).body.error.code, 'DEPOSIT_TOO_HIGH')
    assert.equal((await order(items, { schedule: { scheduledFor: DAY.at('10:00'), slotId: '99999999-9999-4999-8999-999999999999' } })).body.error.code, 'SLOT_INVALID')
    assert.equal(await booked(slotId), 0, 'nada foi reservado nas falhas')
  })

  it('10 reservas simultâneas para capacidade 3 → 3 passam (201), 7 → 409 SLOT_FULL', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => order([{ productId: BOLO, quantity: 1 }], { schedule: { scheduledFor: DAY.at('10:00'), slotId, depositAmount: 20 } })),
    )
    const ok = results.filter((r) => r.status === 201)
    assert.equal(ok.length, 3, results.map((r) => r.status).join(','))
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.error.code === 'SLOT_FULL'))
    assert.equal(await booked(slotId), 3)
    const o = ok[0]!.body
    assert.equal(o.slotId, slotId)
    assert.equal(o.depositAmount, 20)
    assert.equal(new Date(o.scheduledFor).getTime(), new Date(DAY.at('10:00')).getTime())
    // As 7 recusadas não deixaram pedido (rollback).
    assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM orders WHERE slot_id = $1`, [slotId])).rows[0].n, 3)
    const free = await t.api('GET', `/api/scheduling/availability?merchantId=${ZE}&from=${DAY.date}&days=1`, { token: maria() })
    assert.equal(free.body[0].free, 0)
    ;(globalThis as { __bolos?: string[] }).__bolos = ok.map((r) => r.body.id)
  })

  it('cancelar libera a vaga; a agenda do lojista lista as encomendas do dia', async () => {
    const ids = (globalThis as unknown as { __bolos: string[] }).__bolos
    const agenda = await t.api('GET', `/api/scheduling/orders?from=${DAY.date}&to=${DAY.date}`, { token: ze() })
    assert.equal(agenda.status, 200)
    assert.equal(agenda.body.length, 3)
    assert.equal((await t.api('GET', `/api/scheduling/orders?from=${DAY.date}&to=${DAY.date}`, { token: lucia() })).body.length, 0)
    assert.equal((await t.api('GET', `/api/scheduling/orders?from=${DAY.date}&to=${DAY.date}`, { token: maria() })).status, 403)

    assert.equal((await setStatus(ids[0]!, 'CANCELLED')).status, 200)
    assert.equal(await booked(slotId), 2)
    assert.equal((await t.api('GET', `/api/scheduling/orders?from=${DAY.date}&to=${DAY.date}`, { token: ze() })).body.length, 2, 'cancelado sai da agenda')
    const again = await order([{ productId: BOLO, quantity: 1 }], { schedule: { scheduledFor: DAY.at('11:30'), slotId } })
    assert.equal(again.status, 201, JSON.stringify(again.body))
    assert.equal(await booked(slotId), 3)
  })

  it('lojista marca produto como encomenda (lead time); outra loja → 404; produto comum ignora o agendamento', async () => {
    const res = await t.api('PATCH', `/api/scheduling/products/${SUCO}/lead-time`, { token: ze(), body: { leadTimeHours: 12 } })
    assert.equal(res.status, 200)
    assert.equal(res.body.leadTimeHours, 12)
    await t.api('PATCH', `/api/scheduling/products/${SUCO}/lead-time`, { token: ze(), body: { leadTimeHours: 0 } })
    assert.equal((await t.api('PATCH', `/api/scheduling/products/${SUCO}/lead-time`, { token: lucia(), body: { leadTimeHours: 1 } })).status, 404)
    assert.equal((await t.api('PATCH', `/api/scheduling/products/${SUCO}/lead-time`, { token: ze(), body: { leadTimeHours: -1 } })).status, 400)
    assert.equal((await order([{ productId: SUCO, quantity: 1 }])).status, 201)
    const listed = await t.api('GET', `/api/products?merchantId=${ZE}`)
    assert.equal(listed.body.find((p: { id: string }) => p.id === BOLO).leadTimeHours, 48)
  })
})

describe('prato do dia', () => {
  let menuId = ''

  it('lojista liga o prato com 4 porções: vira DAILY_SPECIAL e aparece na vitrine; cliente → 403', async () => {
    const res = await t.api('PUT', '/api/daily-menu', { token: ze(), body: { productId: PRATO, qtyTotal: 4 } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    menuId = res.body.id
    assert.equal(res.body.isOn, true)
    assert.equal(res.body.qtyTotal, 4)
    assert.equal(res.body.qtyAvailable, 4)
    assert.equal(res.body.productName, 'Feijoada do dia')
    assert.equal((await t.db.query(`SELECT kind FROM products WHERE id = $1`, [PRATO])).rows[0].kind, 'DAILY_SPECIAL')
    const pub = await t.api('GET', `/api/daily-menu?merchantId=${ZE}`)
    assert.deepEqual(pub.body.map((i: { productId: string; qtyAvailable: number }) => [i.productId, i.qtyAvailable]), [[PRATO, 4]])
    const prod = await t.api('GET', `/api/products?merchantId=${ZE}`)
    const p = prod.body.find((x: { id: string }) => x.id === PRATO)
    assert.equal(p.kind, 'DAILY_SPECIAL')
    assert.equal(p.stockQty, 4, 'a vitrine enxerga as porções de hoje')
    assert.equal((await t.api('PUT', '/api/daily-menu', { token: maria(), body: { productId: PRATO, qtyTotal: 4 } })).status, 403)
    assert.equal((await t.api('PUT', '/api/daily-menu', { token: lucia(), body: { productId: PRATO, qtyTotal: 4 } })).status, 404, 'produto de outra loja')
    assert.equal((await t.api('PUT', '/api/daily-menu', { token: ze(), body: { productId: PRATO, qtyTotal: -1 } })).status, 400)
  })

  it('10 pedidos simultâneos para 4 porções → 4 passam, 6 → 422 INSUFFICIENT_STOCK; qty_available = 0', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => order([{ productId: PRATO, quantity: 1 }])))
    const ok = results.filter((r) => r.status === 201)
    assert.equal(ok.length, 4, results.map((r) => r.status).join(','))
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 422 && r.body.error.code === 'INSUFFICIENT_STOCK'))
    const row = (await t.db.query(`SELECT qty_available, qty_total FROM daily_menu WHERE id = $1`, [menuId])).rows[0]
    assert.deepEqual(row, { qty_available: 0, qty_total: 4 })
    assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM order_items WHERE product_id = $1`, [PRATO])).rows[0].n, 4)
    ;(globalThis as { __pratos?: string[] }).__pratos = ok.map((r) => r.body.id)
  })

  it('aceitar o pedido não mexe em products.stock_qty (é 0 e passa); cancelar devolve a porção', async () => {
    const ids = (globalThis as unknown as { __pratos: string[] }).__pratos
    assert.equal((await setStatus(ids[0]!, 'IN_PREPARATION')).status, 200)
    assert.equal(await stock(PRATO), 0)
    assert.equal((await setStatus(ids[0]!, 'CANCELLED')).status, 200, 'cancelar depois de aceito também devolve')
    assert.equal((await t.db.query(`SELECT qty_available FROM daily_menu WHERE id = $1`, [menuId])).rows[0].qty_available, 1)
    assert.equal((await setStatus(ids[1]!, 'CANCELLED')).status, 200)
    assert.equal((await t.db.query(`SELECT qty_available FROM daily_menu WHERE id = $1`, [menuId])).rows[0].qty_available, 2)
  })

  it('desligar (toggle OFF) bloqueia a venda e some da vitrine; aumentar o total preserva o vendido', async () => {
    const off = await t.api('PATCH', `/api/daily-menu/${menuId}`, { token: ze(), body: { isOn: false } })
    assert.equal(off.status, 200)
    assert.equal(off.body.isOn, false)
    assert.deepEqual((await t.api('GET', `/api/daily-menu?merchantId=${ZE}`)).body, [])
    const blocked = await order([{ productId: PRATO, quantity: 1 }])
    assert.equal(blocked.status, 422)
    assert.equal(blocked.body.error.code, 'INSUFFICIENT_STOCK')

    const on = await t.api('PATCH', `/api/daily-menu/${menuId}`, { token: ze(), body: { isOn: true, qtyTotal: 6 } })
    assert.equal(on.body.qtyTotal, 6)
    assert.equal(on.body.qtyAvailable, 4, '6 no total − 2 vendidos (os outros dois foram cancelados)')
    assert.equal((await order([{ productId: PRATO, quantity: 4 }])).status, 201)
    assert.equal((await order([{ productId: PRATO, quantity: 1 }])).status, 422)
    assert.equal((await t.api('PATCH', `/api/daily-menu/${menuId}`, { token: lucia(), body: { isOn: false } })).status, 404)
    assert.equal((await t.api('PATCH', `/api/daily-menu/${menuId}`, { token: ze(), body: {} })).status, 400)
    const mine = await t.api('GET', '/api/daily-menu/mine', { token: ze() })
    assert.equal(mine.body[0].qtyAvailable, 0)
  })
})

describe('combos', () => {
  let comboId = ''
  const combo = (over: Record<string, unknown> = {}, token = ze()) =>
    t.api('POST', '/api/combos', {
      token,
      body: { name: 'Combo lanche', description: 'Suco + pão', categoryId: 4, price: 12, components: [{ componentId: SUCO, quantity: 2 }, { componentId: PAOZ, quantity: 1 }], ...over },
    })

  it('cria combo (kind COMBO) com componentes; disponibilidade = o que o estoque permite', async () => {
    const res = await combo()
    assert.equal(res.status, 201, JSON.stringify(res.body))
    comboId = res.body.id
    assert.equal(res.body.price, 12)
    assert.equal(res.body.available, 5, 'min(10 ÷ 2, 6 ÷ 1)')
    assert.deepEqual(res.body.components.map((c: { name: string; quantity: number }) => [c.name, c.quantity]), [['Pão de queijo', 1], ['Suco de caju', 2]])
    assert.equal((await t.db.query(`SELECT kind, stock_qty FROM products WHERE id = $1`, [comboId])).rows[0].kind, 'COMBO')
    const pub = await t.api('GET', `/api/combos?merchantId=${ZE}`)
    assert.equal(pub.body.length, 1)
    const prod = (await t.api('GET', `/api/products?merchantId=${ZE}`)).body.find((p: { id: string }) => p.id === comboId)
    assert.equal(prod.kind, 'COMBO')
    assert.equal(prod.stockQty, 5)
  })

  it('validações: cliente 403; menos de 2 componentes 400; componente repetido 400; de outra loja ou combo → 422', async () => {
    assert.equal((await combo({}, maria())).status, 403)
    assert.equal((await combo({ components: [{ componentId: SUCO, quantity: 1 }] })).status, 400)
    assert.equal((await combo({ components: [{ componentId: SUCO }, { componentId: SUCO }] })).status, 400)
    assert.equal((await combo({ components: [{ componentId: SUCO }, { componentId: ARROZ_LUCIA }] })).body.error.code, 'INVALID_COMPONENTS')
    assert.equal((await combo({ components: [{ componentId: SUCO }, { componentId: comboId }] })).body.error.code, 'INVALID_COMPONENTS')
  })

  it('pedido de combo só confere; ao ACEITAR baixa os componentes (movimento COMBO_COMPONENT); cancelar devolve', async () => {
    const res = await order([{ productId: comboId, quantity: 2 }])
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.totalPrice, 24)
    assert.equal(await stock(SUCO), 10, 'criar o pedido não baixa')

    assert.equal((await setStatus(res.body.id, 'IN_PREPARATION')).status, 200)
    assert.equal(await stock(SUCO), 6, '2 combos × 2 sucos')
    assert.equal(await stock(PAOZ), 4, '2 combos × 1 pão')
    const mv = (await t.db.query(`SELECT product_id, delta, reason FROM stock_movements WHERE order_id = $1 ORDER BY product_id`, [res.body.id])).rows
    assert.deepEqual(mv.map((m) => [m.product_id, m.delta, m.reason]), [[SUCO, -4, 'COMBO_COMPONENT'], [PAOZ, -2, 'COMBO_COMPONENT']])
    assert.equal(await stock(comboId), 0, 'o combo em si não tem estoque próprio')
    assert.equal((await t.api('GET', `/api/combos?merchantId=${ZE}`)).body[0].available, 3, 'min(6 ÷ 2, 4)')

    assert.equal((await setStatus(res.body.id, 'CANCELLED')).status, 200)
    assert.equal(await stock(SUCO), 10)
    assert.equal(await stock(PAOZ), 6)
  })

  it('mais combos que o estoque permite → 422 INSUFFICIENT_STOCK; falta no aceite não baixa nada', async () => {
    const over = await order([{ productId: comboId, quantity: 6 }])
    assert.equal(over.status, 422)
    assert.equal(over.body.error.code, 'INSUFFICIENT_STOCK')
    // Dois pedidos de 3 passam na criação (cada um confere sozinho); o 2º falha no aceite, sem baixar parcial.
    const a = await order([{ productId: comboId, quantity: 3 }])
    const b = await order([{ productId: comboId, quantity: 3 }])
    assert.equal(a.status, 201)
    assert.equal(b.status, 201)
    assert.equal((await setStatus(a.body.id, 'IN_PREPARATION')).status, 200)
    const fail = await setStatus(b.body.id, 'IN_PREPARATION')
    assert.equal(fail.status, 422)
    assert.equal(fail.body.error.code, 'INSUFFICIENT_STOCK')
    assert.equal(await stock(SUCO), 4)
    assert.equal(await stock(PAOZ), 3)
    await setStatus(a.body.id, 'CANCELLED')
    await setStatus(b.body.id, 'CANCELLED')
  })

  it('venda de balcão (PDV) de combo também baixa os componentes; remover o combo some da vitrine', async () => {
    const sale = await t.api('POST', '/api/pos/sales', { token: ze(), body: { items: [{ productId: comboId, quantity: 1 }] } })
    assert.equal(sale.status, 201, JSON.stringify(sale.body))
    assert.equal(await stock(SUCO), 8)
    assert.equal(await stock(PAOZ), 5)
    assert.equal((await t.api('DELETE', `/api/combos/${comboId}`, { token: lucia() })).status, 404)
    assert.equal((await t.api('DELETE', `/api/combos/${comboId}`, { token: ze() })).status, 204)
    assert.deepEqual((await t.api('GET', `/api/combos?merchantId=${ZE}`)).body, [])
  })
})
