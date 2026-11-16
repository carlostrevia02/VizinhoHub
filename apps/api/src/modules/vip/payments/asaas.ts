import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../../shared/errors.js'
import type { HeaderBag, PaymentGatewayProvider, WebhookEvent } from './gateway.js'

// Adapter do Asaas (https://docs.asaas.com). Escrito a partir da documentação pública, SEM chamadas reais nos testes.
// Pontos marcados com "CONFERIR" devem ser validados contra o Sandbox antes de ir para produção.

export interface AsaasOptions {
  apiKey: string
  /** Sandbox: https://api-sandbox.asaas.com/v3 · Produção: https://api.asaas.com/v3 */
  baseUrl: string
  webhookToken: string
  fetchImpl?: typeof fetch
}

// Webhook de cobrança: { id: "evt_...", event: "PAYMENT_RECEIVED", payment: { id: "pay_...", subscription: "sub_...", value, ... } }
// CONFERIR: o campo `id` do evento (usado como chave de idempotência) existe nas versões novas da API; sem ele
// caímos em `${event}:${payment.id}`, que também é estável entre reenvios.
const paymentEvent = z.object({
  id: z.string().optional(),
  event: z.string(),
  payment: z
    .object({
      id: z.string(),
      subscription: z.string().nullish(),
      value: z.number().optional(),
      invoiceUrl: z.string().nullish(),
      paymentDate: z.string().nullish(), // YYYY-MM-DD
      confirmedDate: z.string().nullish(),
    })
    .optional(),
  // CONFERIR: eventos SUBSCRIPTION_* trazem o objeto `subscription` no topo.
  subscription: z.object({ id: z.string() }).optional(),
})

// Quando o dinheiro é considerado recebido. CONFIRMED = cartão aprovado; RECEIVED = Pix/boleto compensado ou
// cartão liquidado. Ambos chegam para o mesmo pagamento: a transição condicional da fatura absorve o 2º.
const PAID_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
const FAILED_EVENTS = new Set(['PAYMENT_OVERDUE'])
const VOID_EVENTS = new Set(['PAYMENT_DELETED', 'PAYMENT_REFUNDED'])
const SUB_CANCELLED_EVENTS = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED'])

export function parseAsaasWebhook(body: unknown): WebhookEvent | null {
  const e = paymentEvent.parse(body)
  const p = e.payment
  const base = { eventId: e.id ?? `${e.event}:${p?.id ?? e.subscription?.id ?? 'sem-id'}` }
  if (SUB_CANCELLED_EVENTS.has(e.event)) {
    const ref = e.subscription?.id ?? p?.subscription ?? undefined
    return ref ? { ...base, kind: 'SUBSCRIPTION_CANCELLED', subscriptionRef: ref } : null
  }
  if (!p) return null
  const common = { ...base, paymentRef: p.id, subscriptionRef: p.subscription ?? undefined, amount: p.value, paymentUrl: p.invoiceUrl ?? undefined }
  if (PAID_EVENTS.has(e.event)) {
    // CONFERIR: paymentDate vem como data (sem hora); usamos meio-dia de Fortaleza (UTC-3) para não cair no dia anterior.
    const day = p.paymentDate ?? p.confirmedDate
    return { ...common, kind: 'PAYMENT_PAID', paidAt: day ? `${day}T12:00:00-03:00` : undefined }
  }
  if (FAILED_EVENTS.has(e.event)) return { ...common, kind: 'PAYMENT_FAILED' }
  if (VOID_EVENTS.has(e.event)) return { ...common, kind: 'PAYMENT_VOID' }
  return null // PAYMENT_CREATED, PAYMENT_UPDATED, PAYMENT_AUTHORIZED etc.: sem efeito para nós
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function createAsaasProvider(opts: AsaasOptions): PaymentGatewayProvider {
  const doFetch = opts.fetchImpl ?? fetch
  const base = opts.baseUrl.replace(/\/+$/, '')

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      // CONFERIR: o Asaas autentica pelo header `access_token` e exige `User-Agent` em contas novas.
      headers: { 'content-type': 'application/json', access_token: opts.apiKey, 'user-agent': 'VizinhoHub/1.0' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const json = text ? (JSON.parse(text) as unknown) : {}
    if (!res.ok) {
      console.error('Asaas: erro', res.status, text.slice(0, 300))
      throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'O provedor de pagamento recusou a operação. Tente novamente.')
    }
    return json as T
  }

  return {
    name: 'asaas',

    async createCustomer({ userId, name, email, cpfCnpj }) {
      // CONFERIR: cpfCnpj é obrigatório para emitir cobrança em produção (no Sandbox costuma aceitar vazio).
      const c = await call<{ id: string }>('POST', '/customers', { name, email, cpfCnpj, externalReference: userId, notificationDisabled: false })
      return { customerRef: c.id }
    },

    async createSubscription({ customerRef, externalReference, description, amount, billingType, nextDueDate }) {
      // CONFERIR: para CREDIT_CARD sem dados do cartão, o cliente informa o cartão na página de pagamento (invoiceUrl).
      const sub = await call<{ id: string }>('POST', '/subscriptions', {
        customer: customerRef,
        billingType,
        value: amount,
        nextDueDate,
        cycle: 'MONTHLY',
        description,
        externalReference,
      })
      // A 1ª cobrança é gerada pelo Asaas junto com a assinatura.
      // CONFERIR: GET /subscriptions/{id}/payments → { data: [{ id, invoiceUrl, status, dueDate }] }.
      const list = await call<{ data?: { id: string; invoiceUrl?: string | null }[] }>('GET', `/subscriptions/${sub.id}/payments`)
      const first = list.data?.[0]
      return { subscriptionRef: sub.id, firstPaymentRef: first?.id ?? null, paymentUrl: first?.invoiceUrl ?? null }
    },

    async cancelSubscription(subscriptionRef) {
      await call('DELETE', `/subscriptions/${subscriptionRef}`) // CONFERIR: responde { deleted: true, id }
    },

    async getSubscription(subscriptionRef) {
      const s = await call<{ status?: string; deleted?: boolean }>('GET', `/subscriptions/${subscriptionRef}`)
      return { status: s.status === 'ACTIVE' && !s.deleted ? 'ACTIVE' : 'INACTIVE' }
    },

    verifyWebhook(headers: HeaderBag) {
      // CONFERIR: o token configurado no painel do webhook chega no header `asaas-access-token`.
      const got = headers['asaas-access-token']
      return typeof got === 'string' && same(got, opts.webhookToken)
    },

    parseWebhook: parseAsaasWebhook,
  }
}
