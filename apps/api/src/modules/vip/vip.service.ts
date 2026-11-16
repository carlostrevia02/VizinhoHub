import type {
  VipInvoiceDTO,
  VipMeDTO,
  VipMerchantDTO,
  VipMerchantSettingsInput,
  VipMerchantStateDTO,
  VipPlanDTO,
} from '@vizinhohub/contracts/vip'
import type { SubscribeVipInput } from '@vizinhohub/contracts/vip'
import { type Db, type DbClient, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import type { HeaderBag, PaymentGatewayProvider, WebhookEvent } from './payments/gateway.js'
import * as repo from './vip.repository.js'

export const MAX_MERCHANT_CAP_PCT = 30 // CHECK de vip_merchants.discount_cap_pct
/** Dias que uma assinatura fica PAST_DUE (benefício suspenso) antes de expirar. */
export const GRACE_DAYS = 3

export interface RenewalResult {
  renewalInvoices: number
  cancelled: number
  expired: number
}

export function createVipService(deps: { db: Db; provider: PaymentGatewayProvider; allowDevPay?: boolean; graceDays?: number }) {
  const { db, provider } = deps
  const allowDevPay = !!deps.allowDevPay && provider.name === 'mock'
  const graceDays = deps.graceDays ?? GRACE_DAYS

  // ---- leitura -------------------------------------------------------------------------------------

  const listPlans = (): Promise<VipPlanDTO[]> => repo.listPlans(db)

  async function me(userId: string): Promise<VipMeDTO> {
    const subscription = (await repo.findCurrentSubscription(db, userId)) ?? null
    const plan = subscription ? ((await repo.findPlan(db, subscription.planId)) ?? null) : null
    const pending = subscription ? await repo.findPendingInvoice(db, subscription.id) : undefined
    const paid = subscription ? (await repo.listInvoices(db, userId)).some((i) => i.subscriptionId === subscription.id && i.status === 'PAID') : false
    const { paymentUrl, ...pendingInvoice } = pending ?? ({} as Partial<NonNullable<typeof pending>>)
    return {
      provider: provider.name,
      plan,
      subscription,
      pendingInvoice: pending ? (pendingInvoice as VipInvoiceDTO) : null,
      awaitingPayment: !!subscription && subscription.status === 'PAST_DUE' && !paid,
      paymentUrl: paymentUrl ?? null,
      canSimulatePayment: allowDevPay && !!pending,
    }
  }

  const invoices = (userId: string): Promise<VipInvoiceDTO[]> => repo.listInvoices(db, userId)

  // ---- assinatura ----------------------------------------------------------------------------------

  async function subscribe(userId: string, input: SubscribeVipInput): Promise<VipMeDTO> {
    const plan = await repo.findPlan(db, input.planId)
    if (!plan || !plan.active) throw new AppError(404, 'PLAN_NOT_FOUND', 'Plano não encontrado.')
    if (await repo.findLiveSubscriptionRow(db, userId)) {
      throw new AppError(409, 'ALREADY_SUBSCRIBED', 'Você já tem uma assinatura do Clube VIP.')
    }
    const { rows } = await db.query<{ name: string; email: string }>(`SELECT name, email::text FROM users WHERE id = $1`, [userId])
    const user = rows[0]!

    // Chamadas ao provedor ficam FORA da transação do banco (rede lenta não segura conexão nem lock).
    const { customerRef } = await provider.createCustomer({ userId, name: user.name, email: user.email, cpfCnpj: input.cpfCnpj })
    const today = new Date().toISOString().slice(0, 10)
    const created = await provider.createSubscription({
      customerRef,
      externalReference: userId,
      description: `${plan.name} · Clube VIP VizinhoHub`,
      amount: plan.priceMonthly,
      billingType: input.billingType,
      nextDueDate: today,
    })

    try {
      await withTransaction(db, async (tx) => {
        const subId = await repo.insertSubscription(tx, { userId, planId: plan.id, provider: provider.name, customerRef, subRef: created.subscriptionRef })
        await repo.insertInvoice(tx, {
          subscriptionId: subId,
          periodStart: today,
          periodEnd: await oneMonthAfter(tx, today),
          amount: plan.priceMonthly,
          provider: provider.name,
          providerRef: created.firstPaymentRef,
          paymentUrl: created.paymentUrl,
        })
      })
    } catch (err) {
      // Não deixa uma assinatura órfã cobrando no provedor.
      await provider.cancelSubscription(created.subscriptionRef).catch((e) => console.error('VIP: falha ao desfazer assinatura no provedor', e))
      throw err
    }
    return me(userId)
  }

  async function oneMonthAfter(q: Pick<Db, 'query'>, day: string): Promise<string> {
    const { rows } = await q.query<{ d: string }>(`SELECT ($1::date + interval '1 month')::date::text AS d`, [day])
    return rows[0]!.d
  }

  async function cancel(userId: string, input: { atPeriodEnd: boolean }): Promise<VipMeDTO> {
    const sub = await repo.findLiveSubscriptionRow(db, userId)
    if (!sub) throw new AppError(404, 'NO_SUBSCRIPTION', 'Você não tem assinatura ativa.')
    // Sem período pago a cumprir (aguardando pagamento) ou pedido imediato: encerra já.
    const immediate = !input.atPeriodEnd || sub.status !== 'ACTIVE'
    await withTransaction(db, async (tx) => {
      const locked = await repo.lockSubscription(tx, sub.id)
      if (!locked || !['ACTIVE', 'PAST_DUE'].includes(locked.status)) return
      if (immediate) {
        await tx.query(`UPDATE vip_subscriptions SET status = 'CANCELLED', cancelled_at = now(), cancel_at_period_end = FALSE WHERE id = $1`, [sub.id])
        await tx.query(`UPDATE vip_invoices SET status = 'VOID' WHERE subscription_id = $1 AND status = 'PENDING'`, [sub.id])
      } else {
        await tx.query(`UPDATE vip_subscriptions SET cancel_at_period_end = TRUE, cancelled_at = now() WHERE id = $1`, [sub.id])
      }
    })
    // Para as próximas cobranças no provedor (o benefício segue até o fim do período pago, se for o caso).
    if (sub.provider_sub_ref) await provider.cancelSubscription(sub.provider_sub_ref).catch((e) => console.error('VIP: falha ao cancelar no provedor', e))
    return me(userId)
  }

  // ---- webhook -------------------------------------------------------------------------------------

  /**
   * Autentica, normaliza e aplica o evento. Idempotente: o id do evento é gravado na MESMA transação dos efeitos
   * (INSERT ... ON CONFLICT DO NOTHING), então reenvios — inclusive simultâneos — viram no-op; e a transição da fatura
   * é condicional (só PENDING/FAILED → PAID), o que também absorve dois eventos distintos para a mesma cobrança.
   */
  async function handleWebhook(providerName: string, headers: HeaderBag, body: unknown): Promise<{ received: true; duplicate: boolean }> {
    if (providerName !== provider.name) throw new AppError(404, 'PROVIDER_NOT_FOUND', 'Provedor não encontrado.')
    if (!provider.verifyWebhook(headers)) throw new AppError(401, 'WEBHOOK_UNAUTHORIZED', 'Webhook não autenticado.')
    const event = provider.parseWebhook(body)
    if (!event) return { received: true, duplicate: false }
    return { received: true, duplicate: !(await processEvent(event)) }
  }

  /** true se o evento foi aplicado agora; false se já tinha sido processado. */
  async function processEvent(ev: WebhookEvent): Promise<boolean> {
    return withTransaction(db, async (tx) => {
      if (!(await repo.registerWebhookEvent(tx, provider.name, ev.eventId, ev.kind))) return false
      await applyEvent(tx, ev)
      return true
    })
  }

  async function applyEvent(tx: DbClient, ev: WebhookEvent) {
    if (ev.kind === 'SUBSCRIPTION_CANCELLED') {
      const sub = ev.subscriptionRef ? await repo.findSubscriptionByProviderRef(tx, provider.name, ev.subscriptionRef) : undefined
      // O provedor parou de cobrar: o benefício vai até o fim do período já pago.
      if (sub && ['ACTIVE', 'PAST_DUE'].includes(sub.status)) {
        await tx.query(
          `UPDATE vip_subscriptions SET cancel_at_period_end = TRUE, cancelled_at = coalesce(cancelled_at, now()) WHERE id = $1`,
          [sub.id],
        )
      }
      return
    }

    // Acha a fatura: pela cobrança do provedor; senão, pela assinatura (a cobrança do ciclo é criada pelo gateway).
    let invoice = ev.paymentRef ? await repo.findInvoiceByRef(tx, provider.name, ev.paymentRef) : undefined
    if (!invoice && ev.subscriptionRef) {
      const sub = await repo.findSubscriptionByProviderRef(tx, provider.name, ev.subscriptionRef)
      if (sub && ev.paymentRef) {
        const open = await repo.findUnreferencedInvoice(tx, sub.id)
        if (open) await repo.setInvoiceRef(tx, open.id, ev.paymentRef, ev.paymentUrl)
        else await repo.insertNextInvoice(tx, sub.id, { provider: provider.name, providerRef: ev.paymentRef, paymentUrl: ev.paymentUrl })
        invoice = await repo.findInvoiceByRef(tx, provider.name, ev.paymentRef)
      }
    }
    if (!invoice) return // cobrança desconhecida: nada a fazer (o evento fica registrado)

    if (ev.kind === 'PAYMENT_PAID') {
      const { rowCount } = await tx.query(
        `UPDATE vip_invoices SET status = 'PAID', paid_at = coalesce($2::timestamptz, now())
          WHERE id = $1 AND status IN ('PENDING', 'FAILED')`,
        [invoice.id, ev.paidAt ?? null],
      )
      if (!rowCount) return // já estava paga (ou anulada): sem segundo efeito
      const sub = await repo.lockSubscription(tx, invoice.subscription_id)
      // Pagamento tardio de assinatura já cancelada/expirada só fica registrado na fatura (estorno é manual).
      if (!sub || !['ACTIVE', 'PAST_DUE'].includes(sub.status)) return
      const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM vip_invoices WHERE subscription_id = $1 AND status = 'PAID'`, [sub.id])
      // Um ciclo a partir do fim do período vigente (ou de agora, se já venceu). Na 1ª fatura paga, "meses de casa" começa agora.
      await tx.query(
        `UPDATE vip_subscriptions SET status = 'ACTIVE',
                started_at = CASE WHEN $2::int = 1 THEN now() ELSE started_at END,
                current_period_start = greatest(current_period_end, now()),
                current_period_end   = greatest(current_period_end, now()) + interval '1 month'
          WHERE id = $1`,
        [sub.id, rows[0]!.n],
      )
    } else if (ev.kind === 'PAYMENT_FAILED') {
      await tx.query(`UPDATE vip_invoices SET status = 'FAILED' WHERE id = $1 AND status = 'PENDING'`, [invoice.id])
    } else if (ev.kind === 'PAYMENT_VOID') {
      await tx.query(`UPDATE vip_invoices SET status = 'VOID' WHERE id = $1 AND status IN ('PENDING', 'FAILED')`, [invoice.id])
    }
  }

  /** Só mock e fora de produção: "confirma" a fatura passando pelo mesmo caminho do webhook. */
  async function simulatePayment(userId: string, invoiceId: string): Promise<VipMeDTO> {
    if (!allowDevPay) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Rota não encontrada.')
    const mine = (await repo.listInvoices(db, userId)).find((i) => i.id === invoiceId)
    if (!mine) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Fatura não encontrada.')
    if (mine.status !== 'PENDING' || !mine.providerRef) throw new AppError(409, 'INVOICE_NOT_PAYABLE', 'Esta fatura não está pendente.')
    await processEvent({ eventId: `dev-pay:${invoiceId}`, kind: 'PAYMENT_PAID', paymentRef: mine.providerRef, amount: mine.amount })
    return me(userId)
  }

  // ---- job de renovação / expiração ----------------------------------------------------------------

  /**
   * Roda de hora em hora (e é idempotente):
   *  1. ACTIVE vencida com cancelamento agendado → CANCELLED.
   *  2. ACTIVE vencida → PAST_DUE (benefício suspenso) e fatura do próximo ciclo. No mock a fatura já nasce com
   *     referência; no Asaas ela fica sem referência e o webhook da cobrança do gateway a associa.
   *  3. PAST_DUE além da carência → EXPIRED; faturas abertas são anuladas e a recorrência no provedor é cancelada.
   * `now` é parâmetro para os testes.
   */
  async function runRenewals(now: Date = new Date()): Promise<RenewalResult> {
    const result: RenewalResult = { renewalInvoices: 0, cancelled: 0, expired: 0 }
    const stopAtProvider: string[] = []

    await withTransaction(db, async (tx) => {
      const cancelled = await tx.query<{ id: string; ref: string | null }>(
        `UPDATE vip_subscriptions SET status = 'CANCELLED'
          WHERE status = 'ACTIVE' AND cancel_at_period_end AND current_period_end <= $1::timestamptz
          RETURNING id, provider_sub_ref AS ref`,
        [now],
      )
      result.cancelled = cancelled.rowCount ?? 0
      for (const r of cancelled.rows) if (r.ref) stopAtProvider.push(r.ref)

      const due = await tx.query<{ id: string }>(
        `UPDATE vip_subscriptions SET status = 'PAST_DUE'
          WHERE status = 'ACTIVE' AND current_period_end <= $1::timestamptz RETURNING id`,
        [now],
      )
      for (const { id } of due.rows) {
        const ref = provider.name === 'mock' ? `mock_pay_${crypto.randomUUID()}` : null
        if (await repo.insertNextInvoice(tx, id, { provider: provider.name, providerRef: ref })) result.renewalInvoices++
      }

      const expired = await tx.query<{ id: string; ref: string | null }>(
        `UPDATE vip_subscriptions SET status = 'EXPIRED'
          WHERE status = 'PAST_DUE' AND current_period_end + make_interval(days => $2::int) <= $1::timestamptz
          RETURNING id, provider_sub_ref AS ref`,
        [now, graceDays],
      )
      result.expired = expired.rowCount ?? 0
      for (const r of expired.rows) if (r.ref) stopAtProvider.push(r.ref)

      const closed = [...cancelled.rows, ...expired.rows].map((r) => r.id)
      if (closed.length) {
        await tx.query(`UPDATE vip_invoices SET status = 'VOID' WHERE subscription_id = ANY($1::uuid[]) AND status IN ('PENDING', 'FAILED')`, [closed])
      }
    })

    // Fora da transação: para as cobranças no provedor (falha só é registrada; o provedor também expira sozinho).
    for (const ref of stopAtProvider) await provider.cancelSubscription(ref).catch((e) => console.error('VIP: falha ao cancelar no provedor', e))
    return result
  }

  // ---- lojista -------------------------------------------------------------------------------------

  async function merchantState(merchantId: string): Promise<VipMerchantStateDTO> {
    const settings = (await repo.findMerchant(db, merchantId)) ?? null
    return { enrolled: !!settings, settings, maxCapPct: MAX_MERCHANT_CAP_PCT, stats: await repo.merchantStats(db, merchantId) }
  }

  // Adesão e ajuste (o schema já limita o teto a 0–30 %; o CHECK da tabela é a segunda barreira).
  async function enroll(merchantId: string, input: VipMerchantSettingsInput): Promise<VipMerchantDTO> {
    return repo.upsertMerchant(db, merchantId, input)
  }

  async function leave(merchantId: string): Promise<void> {
    if (!(await repo.deleteMerchant(db, merchantId))) throw new AppError(404, 'NOT_ENROLLED', 'Sua loja não está no Clube VIP.')
  }

  return { listPlans, me, invoices, subscribe, cancel, handleWebhook, processEvent, simulatePayment, runRenewals, merchantState, enroll, leave }
}

export type VipService = ReturnType<typeof createVipService>
