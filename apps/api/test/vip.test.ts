// Clube VIP (Selo Vizinho VIP): assinatura, webhook idempotente, desconto no pedido, job e adapter Asaas.
// Provedor mock (padrão de teste); o adapter Asaas é testado com JSON fixo e fetch simulado — sem rede.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createAsaasProvider, parseAsaasWebhook } from '../src/modules/vip/payments/asaas.js'
import { createMockProvider } from '../src/modules/vip/payments/mock.js'
import { createVipService } from '../src/modules/vip/vip.service.js'
import { CREME, IOGURTE, ARROZ_LUCIA, LUCIA, ZE, startTestEnv, tokenFor, type TestEnv } from './helpers.js'

let t: TestEnv
let planId = 0
let customerSeq = 0
const SECRET = 'dev-vip-webhook-secret' // padrão do env fora de produção
const ze = () => tokenFor(ZE)
const lucia = () => tokenFor(LUCIA)

// Serviço próprio só para chamar o job (a API sob teste usa o mesmo mock e o mesmo banco).
let vipSvc: ReturnType<typeof createVipService>

before(async () => {
  t = await startTestEnv()
  planId = (await t.db.query(`SELECT id FROM vip_plans WHERE code = 'vizinho-vip'`)).rows[0].id
  vipSvc = createVipService({ db: t.db, provider: createMockProvider({ secret: SECRET }), allowDevPay: true })
})
after(() => t?.stop())

async function newCustomer() {
  const { rows } = await t.db.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', 'CUSTOMER') RETURNING id`,
    [`Cliente VIP ${++customerSeq}`, `vip${customerSeq}-${Math.random().toString(36).slice(2)}@vizinhohub.test`],
  )
  const id = rows[0].id as string
  return { id, token: tokenFor(id) }
}

type Customer = Awaited<ReturnType<typeof newCustomer>>
const subscribe = (c: Customer) => t.api('POST', '/api/vip/subscribe', { token: c.token, body: { planId } })
const me = async (c: Customer) => (await t.api('GET', '/api/vip/me', { token: c.token })).body

async function webhook(body: unknown, secret: string | null = SECRET, provider = 'mock') {
  const res = await fetch(`${t.baseUrl}/api/vip/webhooks/${provider}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret !== null && { 'x-vip-webhook-secret': secret }) },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

const payEvent = (paymentRef: string, eventId = `evt-${Math.random().toString(36).slice(2)}`) => ({ eventId, kind: 'PAYMENT_PAID', paymentRef })

/** Cliente assinante com a 1ª fatura paga (assinatura ACTIVE, 1º mês → faixa de 2 %). */
async function activeSubscriber() {
  const c = await newCustomer()
  const sub = await subscribe(c)
  assert.equal(sub.status, 201, JSON.stringify(sub.body))
  const paid = await webhook(payEvent(sub.body.pendingInvoice.providerRef))
  assert.equal(paid.status, 200)
  assert.equal((await me(c)).subscription.status, 'ACTIVE')
  return c
}

const order = (token: string, items: unknown[]) => t.api('POST', '/api/orders', { token, body: { items } })
const subRow = async (userId: string) => (await t.db.query(`SELECT * FROM vip_subscriptions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1`, [userId])).rows[0]

describe('planos', () => {
  it('GET /vip/plans é público e traz as faixas', async () => {
    const res = await t.api('GET', '/api/vip/plans')
    assert.equal(res.status, 200)
    const plan = res.body.find((p: { code: string }) => p.code === 'vizinho-vip')
    assert.equal(plan.priceMonthly, 14.9)
    assert.deepEqual(plan.tiers.map((x: { minMonths: number }) => x.minMonths), [1, 3, 6, 12])
  })
})

describe('assinatura (provedor mock)', () => {
  it('assinar cria a assinatura aguardando pagamento e a fatura PENDING; ainda sem desconto', async () => {
    const c = await newCustomer()
    const res = await subscribe(c)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.provider, 'mock')
    assert.equal(res.body.subscription.status, 'PAST_DUE')
    assert.equal(res.body.subscription.discountPct, 0)
    assert.equal(res.body.awaitingPayment, true)
    assert.equal(res.body.canSimulatePayment, true)
    assert.equal(res.body.pendingInvoice.status, 'PENDING')
    assert.equal(res.body.pendingInvoice.amount, 14.9)
    assert.match(res.body.pendingInvoice.providerRef, /^mock_pay_/)
    const invoices = await t.api('GET', '/api/vip/invoices', { token: c.token })
    assert.equal(invoices.body.length, 1)
  })

  it('assinar de novo → 409; lojista não assina → 403; plano inexistente → 404; sem login → 401', async () => {
    const c = await newCustomer()
    await subscribe(c)
    assert.equal((await subscribe(c)).body.error.code, 'ALREADY_SUBSCRIBED')
    assert.equal((await t.api('POST', '/api/vip/subscribe', { token: ze(), body: { planId } })).status, 403)
    assert.equal((await t.api('POST', '/api/vip/subscribe', { token: (await newCustomer()).token, body: { planId: 9999 } })).status, 404)
    assert.equal((await t.api('GET', '/api/vip/me')).status, 401)
  })

  it('webhook de pagamento → assinatura ativa, fatura paga, 1º mês (2 %)', async () => {
    const c = await newCustomer()
    const { body } = await subscribe(c)
    const res = await webhook({ ...payEvent(body.pendingInvoice.providerRef), paidAt: '2026-01-10T12:00:00-03:00' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { received: true, duplicate: false })
    const now = await me(c)
    assert.equal(now.subscription.status, 'ACTIVE')
    assert.equal(now.subscription.discountPct, 2)
    assert.equal(now.awaitingPayment, false)
    assert.equal(now.pendingInvoice, null)
    const [inv] = (await t.api('GET', '/api/vip/invoices', { token: c.token })).body
    assert.equal(inv.status, 'PAID')
    assert.equal(inv.paidAt, '2026-01-10T15:00:00.000Z')
    const days = (new Date(now.subscription.currentPeriodEnd).getTime() - Date.now()) / 86_400_000
    assert.ok(days > 27 && days < 32, `um ciclo de ~1 mês, veio ${days.toFixed(1)} dias`)
  })

  it('o MESMO webhook 5 vezes, inclusive simultâneas → 1 fatura paga e 1 efeito', async () => {
    const c = await newCustomer()
    const { body } = await subscribe(c)
    const evt = payEvent(body.pendingInvoice.providerRef, 'evt-repetido')
    const results = await Promise.all(Array.from({ length: 5 }, () => webhook(evt)))
    assert.ok(results.every((r) => r.status === 200))
    assert.equal(results.filter((r) => r.body.duplicate === false).length, 1, 'só um aplica')
    assert.equal(results.filter((r) => r.body.duplicate === true).length, 4)
    // reenvio posterior também é no-op
    assert.equal((await webhook(evt)).body.duplicate, true)

    const row = await subRow(c.id)
    assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM vip_invoices WHERE subscription_id = $1 AND status = 'PAID'`, [row.id])).rows[0].n, 1)
    assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM vip_webhook_events WHERE event_id = 'evt-repetido'`)).rows[0].n, 1)
    const days = (row.current_period_end.getTime() - Date.now()) / 86_400_000
    assert.ok(days < 32, `o período avançou uma vez só (${days.toFixed(1)} dias)`)
  })

  it('dois eventos DIFERENTES para a mesma cobrança (CONFIRMED + RECEIVED) também têm um efeito só', async () => {
    const c = await newCustomer()
    const { body } = await subscribe(c)
    const ref = body.pendingInvoice.providerRef
    const results = await Promise.all([webhook(payEvent(ref, 'evt-a')), webhook(payEvent(ref, 'evt-b'))])
    assert.ok(results.every((r) => r.status === 200))
    const row = await subRow(c.id)
    assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM vip_invoices WHERE subscription_id = $1 AND status = 'PAID'`, [row.id])).rows[0].n, 1)
    assert.ok((row.current_period_end.getTime() - Date.now()) / 86_400_000 < 32)
  })

  it('webhook com segredo inválido, ausente ou provedor errado → 401/404 e nada muda', async () => {
    const c = await newCustomer()
    const { body } = await subscribe(c)
    const evt = payEvent(body.pendingInvoice.providerRef)
    assert.equal((await webhook(evt, 'segredo-errado')).status, 401)
    assert.equal((await webhook(evt, null)).status, 401)
    assert.equal((await webhook(evt, SECRET, 'asaas')).status, 404)
    assert.equal((await webhook({ nada: true })).status, 400)
    const now = await me(c)
    assert.equal(now.subscription.status, 'PAST_DUE')
    assert.equal(now.pendingInvoice.status, 'PENDING')
    assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM vip_webhook_events WHERE event_id = $1`, [evt.eventId])).rows[0].n, 0)
  })

  it('falha de pagamento marca a fatura FAILED; um pagamento posterior ainda ativa', async () => {
    const c = await newCustomer()
    const { body } = await subscribe(c)
    const ref = body.pendingInvoice.providerRef
    await webhook({ eventId: 'evt-fail-1', kind: 'PAYMENT_FAILED', paymentRef: ref })
    assert.equal((await t.api('GET', '/api/vip/invoices', { token: c.token })).body[0].status, 'FAILED')
    await webhook(payEvent(ref))
    assert.equal((await me(c)).subscription.status, 'ACTIVE')
  })

  it('rota de dev "simular pagamento" passa pelo mesmo caminho do webhook', async () => {
    const c = await newCustomer()
    const { body } = await subscribe(c)
    const res = await t.api('POST', `/api/vip/dev/invoices/${body.pendingInvoice.id}/pay`, { token: c.token })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.subscription.status, 'ACTIVE')
    const again = await t.api('POST', `/api/vip/dev/invoices/${body.pendingInvoice.id}/pay`, { token: c.token })
    assert.equal(again.status, 409, 'fatura já paga não é paga de novo')
  })

  it('cancelar: no fim do período mantém o benefício; imediato encerra; aguardando pagamento encerra já', async () => {
    const c = await activeSubscriber()
    const res = await t.api('POST', '/api/vip/cancel', { token: c.token, body: {} })
    assert.equal(res.status, 200)
    assert.equal(res.body.subscription.status, 'ACTIVE')
    assert.equal(res.body.subscription.cancelAtPeriodEnd, true)
    assert.equal(res.body.subscription.discountPct, 2)

    const imm = await activeSubscriber()
    const r2 = await t.api('POST', '/api/vip/cancel', { token: imm.token, body: { atPeriodEnd: false } })
    assert.equal(r2.body.subscription.status, 'CANCELLED')
    assert.equal(r2.body.subscription.discountPct, 0)

    const waiting = await newCustomer()
    await subscribe(waiting)
    const r3 = await t.api('POST', '/api/vip/cancel', { token: waiting.token, body: {} })
    assert.equal(r3.body.subscription.status, 'CANCELLED')
    assert.equal(r3.body.pendingInvoice, null)
    assert.equal((await t.api('POST', '/api/vip/cancel', { token: waiting.token, body: {} })).status, 404)
  })
})

describe('adesão do lojista', () => {
  it('só lojista; aderir com padrões, ajustar dentro do teto, fora do teto → 400, sair', async () => {
    assert.equal((await t.api('GET', '/api/vip/merchant', { token: (await newCustomer()).token })).status, 403)
    const before = await t.api('GET', '/api/vip/merchant', { token: lucia() })
    assert.equal(before.body.enrolled, false)
    assert.equal(before.body.maxCapPct, 30)

    const join = await t.api('POST', '/api/vip/merchant', { token: lucia(), body: {} })
    assert.equal(join.status, 201)
    assert.equal(join.body.settings.discountCapPct, 10)
    assert.equal(join.body.settings.fundsFreeDelivery, false)

    const upd = await t.api('PUT', '/api/vip/merchant', { token: lucia(), body: { discountCapPct: 5.5, fundsFreeDelivery: true } })
    assert.equal(upd.body.settings.discountCapPct, 5.5)
    assert.equal(upd.body.settings.fundsFreeDelivery, true)
    assert.equal(upd.body.settings.discountEnabled, true, 'o que não veio é mantido')

    assert.equal((await t.api('PUT', '/api/vip/merchant', { token: lucia(), body: { discountCapPct: 31 } })).status, 400)
    assert.equal((await t.api('PUT', '/api/vip/merchant', { token: lucia(), body: { discountCapPct: 5.55 } })).status, 400)
    assert.equal((await t.api('PUT', '/api/vip/merchant', { token: lucia(), body: {} })).status, 400)

    assert.equal((await t.api('DELETE', '/api/vip/merchant', { token: lucia() })).status, 204)
    assert.equal((await t.api('DELETE', '/api/vip/merchant', { token: lucia() })).status, 404)
    assert.equal((await t.api('GET', '/api/vip/merchant', { token: lucia() })).body.enrolled, false)
  })
})

describe('desconto no pedido', () => {
  it('só em loja aderente e só com assinatura ativa; vip_savings correto; teto da loja respeitado', async () => {
    const vip = await activeSubscriber()
    const plain = await newCustomer()
    const waiting = await newCustomer()
    await subscribe(waiting)

    // Loja do Zé ainda não aderiu: sem desconto mesmo para VIP.
    const noStore = await order(vip.token, [{ productId: CREME, quantity: 10 }])
    assert.equal(noStore.status, 201, JSON.stringify(noStore.body))
    assert.equal(noStore.body.vipSavings, 0)
    assert.equal(noStore.body.items[0].unitPrice, 4.29)
    assert.equal(noStore.body.totalPrice, 42.9)

    await t.api('POST', '/api/vip/merchant', { token: ze(), body: { discountCapPct: 10 } })

    // VIP ativo (faixa 2 %, abaixo do teto 10 %): 4,29 → 4,20 por unidade; 10 un → economiza 0,90.
    const hit = await order(vip.token, [{ productId: CREME, quantity: 10 }])
    assert.equal(hit.status, 201)
    assert.equal(hit.body.items[0].unitPrice, 4.2)
    assert.equal(hit.body.totalPrice, 42)
    assert.equal(hit.body.vipSavings, 0.9)
    const stored = (await t.db.query(`SELECT vip_savings::text AS s, total_price::text AS tp FROM orders WHERE id = $1`, [hit.body.id])).rows[0]
    assert.deepEqual(stored, { s: '0.90', tp: '42.00' })
    // o detalhe do pedido também traz a economia
    assert.equal((await t.api('GET', `/api/orders/${hit.body.id}`, { token: vip.token })).body.vipSavings, 0.9)

    // Sem assinatura, ou assinatura ainda não paga: preço cheio.
    for (const c of [plain, waiting]) {
      const r = await order(c.token, [{ productId: CREME, quantity: 10 }])
      assert.equal(r.body.vipSavings, 0)
      assert.equal(r.body.totalPrice, 42.9)
    }

    // Loja da Lúcia nunca aderiu: sem desconto para o VIP.
    const lu = await order(vip.token, [{ productId: ARROZ_LUCIA, quantity: 1 }])
    assert.equal(lu.status, 201, JSON.stringify(lu.body))
    assert.equal(lu.body.vipSavings, 0)

    // Teto da loja (1 %) vale mais que a faixa do cliente (2 %): 4,29 → 4,25 (arredondado); 10 un → 0,40.
    await t.api('PUT', '/api/vip/merchant', { token: ze(), body: { discountCapPct: 1 } })
    const capped = await order(vip.token, [{ productId: CREME, quantity: 10 }])
    assert.equal(capped.body.items[0].unitPrice, 4.25)
    assert.equal(capped.body.vipSavings, 0.4)

    // Loja desliga o desconto: volta ao preço cheio.
    await t.api('PUT', '/api/vip/merchant', { token: ze(), body: { discountEnabled: false } })
    assert.equal((await order(vip.token, [{ productId: CREME, quantity: 1 }])).body.vipSavings, 0)

    // Estatística do lojista: 2 pedidos com benefício deste cliente (0,90 + 0,40).
    const stats = (await t.api('GET', '/api/vip/merchant', { token: ze() })).body.stats
    assert.ok(stats.orders >= 2 && stats.totalSavings >= 1.3 - 1e-9)
    await t.api('DELETE', '/api/vip/merchant', { token: ze() })
  })

  it('não desconta item de oferta relâmpago, mas desconta os demais itens do mesmo pedido', async () => {
    const vip = await activeSubscriber()
    await t.api('POST', '/api/vip/merchant', { token: ze(), body: { discountCapPct: 10 } })
    const offer = await t.api('POST', '/api/flash', { token: ze(), body: { productId: CREME, offerPrice: 3.5, qtyTotal: 10, maxPerCustomer: 3, durationMin: 60 } })
    assert.equal(offer.status, 201, JSON.stringify(offer.body))

    const res = await order(vip.token, [{ flashOfferId: offer.body.id, quantity: 2 }, { productId: IOGURTE, quantity: 1 }])
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const byProduct = (id: string) => res.body.items.find((i: { productId: string }) => i.productId === id)
    assert.equal(byProduct(CREME).unitPrice, 3.5, 'preço relâmpago intacto')
    assert.equal(byProduct(IOGURTE).unitPrice, 2.67, '2,72 com 2 % = 2,67')
    assert.equal(res.body.vipSavings, 0.05)
    assert.equal(res.body.totalPrice, 9.67)

    const onlyFlash = await order(vip.token, [{ flashOfferId: offer.body.id, quantity: 1 }])
    assert.equal(onlyFlash.body.vipSavings, 0)
    assert.equal(onlyFlash.body.totalPrice, 3.5)
    await t.api('DELETE', '/api/vip/merchant', { token: ze() })
  })
})

describe('job de renovação / expiração', () => {
  const setPeriodEnd = (userId: string, sql: string) => t.db.query(`UPDATE vip_subscriptions SET current_period_end = ${sql} WHERE user_id = $1`, [userId])

  it('vencida → PAST_DUE com fatura do próximo ciclo (idempotente); paga → volta a ACTIVE; muito vencida → EXPIRED', async () => {
    const c = await activeSubscriber()
    await setPeriodEnd(c.id, `now() - interval '1 day'`)

    const first = await vipSvc.runRenewals()
    assert.equal(first.renewalInvoices >= 1, true)
    const after1 = await me(c)
    assert.equal(after1.subscription.status, 'PAST_DUE')
    assert.equal(after1.subscription.discountPct, 0, 'benefício suspenso')
    assert.equal(after1.pendingInvoice.status, 'PENDING')
    const invoices = (await t.api('GET', '/api/vip/invoices', { token: c.token })).body
    assert.equal(invoices.length, 2)

    // Rodar de novo não duplica a fatura nem muda o status.
    await vipSvc.runRenewals()
    assert.equal((await t.api('GET', '/api/vip/invoices', { token: c.token })).body.length, 2)

    // Pagou o novo ciclo: volta a ACTIVE e o período avança um mês a partir de agora.
    await webhook(payEvent(after1.pendingInvoice.providerRef))
    const renewed = await me(c)
    assert.equal(renewed.subscription.status, 'ACTIVE')
    assert.ok((new Date(renewed.subscription.currentPeriodEnd).getTime() - Date.now()) / 86_400_000 > 27)

    // Venceu há mais que a carência: ACTIVE → PAST_DUE → EXPIRED na mesma rodada; faturas abertas anuladas.
    await setPeriodEnd(c.id, `now() - interval '10 days'`)
    const second = await vipSvc.runRenewals()
    assert.ok(second.expired >= 1)
    const expired = await me(c)
    assert.equal(expired.subscription.status, 'EXPIRED')
    assert.equal(expired.pendingInvoice, null)
    assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM vip_invoices i JOIN vip_subscriptions s ON s.id = i.subscription_id WHERE s.user_id = $1 AND i.status = 'VOID'`, [c.id])).rows[0].n, 1)

    // Expirada, a pessoa pode assinar de novo.
    assert.equal((await subscribe(c)).status, 201)
  })

  it('assinatura nunca paga expira depois da carência; cancelamento agendado vira CANCELLED no vencimento', async () => {
    const unpaid = await newCustomer()
    await subscribe(unpaid)
    await vipSvc.runRenewals()
    assert.equal((await me(unpaid)).subscription.status, 'PAST_DUE', 'dentro da carência')
    const future = new Date(Date.now() + 4 * 86_400_000)
    assert.ok((await vipSvc.runRenewals(future)).expired >= 1)
    assert.equal((await me(unpaid)).subscription.status, 'EXPIRED')

    const leaving = await activeSubscriber()
    await t.api('POST', '/api/vip/cancel', { token: leaving.token, body: {} })
    await vipSvc.runRenewals() // ainda no período pago: nada muda
    assert.equal((await me(leaving)).subscription.status, 'ACTIVE')
    await vipSvc.runRenewals(new Date(Date.now() + 40 * 86_400_000))
    const done = await me(leaving)
    assert.equal(done.subscription.status, 'CANCELLED')
    assert.equal(done.pendingInvoice, null)
  })
})

describe('adapter Asaas (JSON fixo, sem rede)', () => {
  const header = { 'asaas-access-token': 'token-do-webhook-1234' }

  it('mapeia PAYMENT_RECEIVED e PAYMENT_CONFIRMED para pagamento, com id do evento e assinatura', () => {
    const body = {
      id: 'evt_05b708f961d739ea7eba7e4db318f621&368604920',
      event: 'PAYMENT_RECEIVED',
      dateCreated: '2026-02-10 09:30:00',
      payment: { object: 'payment', id: 'pay_080225913252', subscription: 'sub_vu4rk8wkxe8bgn9j', customer: 'cus_000005219613', value: 14.9, billingType: 'PIX', status: 'RECEIVED', dueDate: '2026-02-10', paymentDate: '2026-02-10', invoiceUrl: 'https://sandbox.asaas.com/i/080225913252' },
    }
    assert.deepEqual(parseAsaasWebhook(body), {
      eventId: 'evt_05b708f961d739ea7eba7e4db318f621&368604920',
      kind: 'PAYMENT_PAID',
      paymentRef: 'pay_080225913252',
      subscriptionRef: 'sub_vu4rk8wkxe8bgn9j',
      amount: 14.9,
      paymentUrl: 'https://sandbox.asaas.com/i/080225913252',
      paidAt: '2026-02-10T12:00:00-03:00',
    })
    assert.equal(parseAsaasWebhook({ ...body, event: 'PAYMENT_CONFIRMED' })?.kind, 'PAYMENT_PAID')
  })

  it('mapeia vencida/removida/assinatura cancelada e ignora eventos sem efeito; sem id usa evento+cobrança', () => {
    const payment = { id: 'pay_1', subscription: 'sub_1', value: 14.9 }
    assert.equal(parseAsaasWebhook({ id: 'evt_1', event: 'PAYMENT_OVERDUE', payment })?.kind, 'PAYMENT_FAILED')
    assert.equal(parseAsaasWebhook({ id: 'evt_2', event: 'PAYMENT_DELETED', payment })?.kind, 'PAYMENT_VOID')
    assert.equal(parseAsaasWebhook({ id: 'evt_3', event: 'PAYMENT_CREATED', payment }), null)
    assert.deepEqual(parseAsaasWebhook({ id: 'evt_4', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_9' } }), { eventId: 'evt_4', kind: 'SUBSCRIPTION_CANCELLED', subscriptionRef: 'sub_9' })
    assert.equal(parseAsaasWebhook({ event: 'PAYMENT_RECEIVED', payment })?.eventId, 'PAYMENT_RECEIVED:pay_1')
    assert.throws(() => parseAsaasWebhook({ nada: 1 }))
  })

  it('autentica pelo header asaas-access-token', () => {
    const p = createAsaasProvider({ apiKey: 'k', baseUrl: 'https://x/v3', webhookToken: 'token-do-webhook-1234' })
    assert.equal(p.verifyWebhook(header), true)
    assert.equal(p.verifyWebhook({ 'asaas-access-token': 'outro' }), false)
    assert.equal(p.verifyWebhook({}), false)
  })

  it('cria cliente e assinatura pela API (fetch simulado) e acha a 1ª cobrança', async () => {
    const calls: { method: string; url: string; body: any; token: string }[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, body: init.body ? JSON.parse(init.body as string) : undefined, token: (init.headers as Record<string, string>).access_token! })
      const json = url.endsWith('/customers') ? { id: 'cus_1' } : url.endsWith('/subscriptions') ? { id: 'sub_1' } : { data: [{ id: 'pay_1', invoiceUrl: 'https://pay/1' }] }
      return new Response(JSON.stringify(json), { status: 200 })
    }) as unknown as typeof fetch
    const p = createAsaasProvider({ apiKey: 'chave', baseUrl: 'https://sandbox/v3/', webhookToken: 'token-do-webhook-1234', fetchImpl })
    const { customerRef } = await p.createCustomer({ userId: 'u1', name: 'Ana', email: 'ana@x.test', cpfCnpj: '12345678909' })
    const sub = await p.createSubscription({ customerRef, externalReference: 'u1', description: 'VIP', amount: 14.9, billingType: 'PIX', nextDueDate: '2026-02-10' })
    assert.deepEqual(sub, { subscriptionRef: 'sub_1', firstPaymentRef: 'pay_1', paymentUrl: 'https://pay/1' })
    assert.equal(calls[0]!.url, 'https://sandbox/v3/customers')
    assert.equal(calls[1]!.body.cycle, 'MONTHLY')
    assert.equal(calls[1]!.body.customer, 'cus_1')
    assert.ok(calls.every((c) => c.token === 'chave'))
  })
})
