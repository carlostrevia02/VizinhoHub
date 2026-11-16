import { randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { HeaderBag, PaymentGatewayProvider, WebhookEvent } from './gateway.js'

// Corpo do webhook do mock (o formato é nosso; o teste e a rota de dev usam o mesmo).
export const mockWebhookBody = z.object({
  eventId: z.string().trim().min(1).max(200),
  kind: z.enum(['PAYMENT_PAID', 'PAYMENT_FAILED', 'PAYMENT_VOID', 'SUBSCRIPTION_CANCELLED']),
  paymentRef: z.string().trim().min(1).max(200).optional(),
  subscriptionRef: z.string().trim().min(1).max(200).optional(),
  amount: z.number().nonnegative().optional(),
  paidAt: z.iso.datetime({ offset: true }).optional(),
})

export const MOCK_SECRET_HEADER = 'x-vip-webhook-secret'

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// Simula o gateway: nenhuma chamada de rede; as referências são aleatórias. Sem `secret`, recusa todo webhook.
export function createMockProvider(opts: { secret?: string } = {}): PaymentGatewayProvider {
  return {
    name: 'mock',
    async createCustomer() {
      return { customerRef: `mock_cus_${randomUUID()}` }
    },
    async createSubscription() {
      return { subscriptionRef: `mock_sub_${randomUUID()}`, firstPaymentRef: `mock_pay_${randomUUID()}`, paymentUrl: null }
    },
    async cancelSubscription() {},
    async getSubscription() {
      return { status: 'ACTIVE' }
    },
    verifyWebhook(headers: HeaderBag) {
      const got = headers[MOCK_SECRET_HEADER]
      return !!opts.secret && typeof got === 'string' && same(got, opts.secret)
    },
    parseWebhook(body): WebhookEvent {
      return mockWebhookBody.parse(body)
    },
  }
}
