// Adapter de pagamento do Clube VIP. A plataforma NÃO custodia valores: quem cobra e recebe é o provedor.
// O resto do módulo só conhece esta interface; tudo que é específico de um gateway fica na implementação.

export type BillingType = 'PIX' | 'CREDIT_CARD'

export interface CreateCustomerInput {
  userId: string
  name: string
  email: string
  cpfCnpj?: string
}

export interface CreateSubscriptionInput {
  customerRef: string
  /** Referência nossa (id da assinatura local não existe ainda; usamos o usuário). Volta nos webhooks. */
  externalReference: string
  description: string
  amount: number
  billingType: BillingType
  /** Primeira cobrança, YYYY-MM-DD. */
  nextDueDate: string
}

export interface CreatedSubscription {
  subscriptionRef: string
  /** Cobrança do 1º ciclo, quando o provedor já a devolve. */
  firstPaymentRef: string | null
  /** Link de pagamento (onde o cliente paga com Pix/cartão). */
  paymentUrl: string | null
}

export interface ProviderSubscriptionState {
  status: 'ACTIVE' | 'INACTIVE'
}

/** Evento de webhook já normalizado (independe do formato do provedor). */
export interface WebhookEvent {
  /** Chave de idempotência: o mesmo evento reenviado traz o mesmo id. */
  eventId: string
  kind: 'PAYMENT_PAID' | 'PAYMENT_FAILED' | 'PAYMENT_VOID' | 'SUBSCRIPTION_CANCELLED'
  /** Cobrança no provedor (casa com vip_invoices.provider_ref). */
  paymentRef?: string
  /** Assinatura recorrente no provedor (casa com vip_subscriptions.provider_sub_ref). */
  subscriptionRef?: string
  amount?: number
  /** ISO 8601 */
  paidAt?: string
  paymentUrl?: string
}

export type HeaderBag = Record<string, string | string[] | undefined>

export interface PaymentGatewayProvider {
  readonly name: 'mock' | 'asaas'
  createCustomer(input: CreateCustomerInput): Promise<{ customerRef: string }>
  createSubscription(input: CreateSubscriptionInput): Promise<CreatedSubscription>
  cancelSubscription(subscriptionRef: string): Promise<void>
  getSubscription(subscriptionRef: string): Promise<ProviderSubscriptionState>
  /** true se o webhook veio mesmo do provedor (token/segredo no header). */
  verifyWebhook(headers: HeaderBag): boolean
  /** Normaliza o corpo. null = evento que não nos interessa (responde 200 e ignora). Lança ZodError se o formato for inválido. */
  parseWebhook(body: unknown): WebhookEvent | null
}
