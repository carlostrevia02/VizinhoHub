import { z } from 'zod'
import { moneyNonNeg } from './common.js'

// Módulo 009 · Clube de Vantagens / Selo Vizinho VIP (db/migrations/009-clube-vip.sql).

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'] as const
export const INVOICE_STATUSES = ['PENDING', 'PAID', 'FAILED', 'VOID'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

// NUMERIC(4,1) com CHECK 0..30: uma casa decimal.
const pct = z
  .number()
  .min(0)
  .max(30)
  .refine((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6, 'Use no máximo 1 casa decimal.')

// ---- Entradas -------------------------------------------------------------------------------------

// Faixa de desconto progressivo: a partir de N meses de assinatura. SMALLINT >= 1.
export const vipTierSchema = z.object({
  minMonths: z.number().int().min(1).max(32_767),
  discountPct: pct,
})

// Cadastro de plano (backoffice da plataforma).
export const createVipPlanSchema = z
  .object({
    code: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(60),
    priceMonthly: moneyNonNeg(),
    freeDelivery: z.boolean().default(true),
    freeDeliveryMinOrder: moneyNonNeg().default(0),
    active: z.boolean().default(true),
    tiers: z.array(vipTierSchema).max(12).default([]),
  })
  .refine((v) => new Set(v.tiers.map((t) => t.minMonths)).size === v.tiers.length, 'minMonths repetido nas faixas.')
export type CreateVipPlanInput = z.infer<typeof createVipPlanSchema>

// billingType: Pix ou cartão (o gateway cobra todo mês). cpfCnpj: exigido pelo Asaas para emitir a cobrança.
export const subscribeVipSchema = z.object({
  planId: z.number().int().positive(),
  billingType: z.enum(['PIX', 'CREDIT_CARD']).default('PIX'),
  cpfCnpj: z
    .string()
    .trim()
    .regex(/^\d{11}(\d{3})?$/, 'Informe só os números do CPF ou CNPJ.')
    .optional(),
})
export type SubscribeVipInput = z.infer<typeof subscribeVipSchema>

// Cancelar: por padrão vale até o fim do período já pago.
export const cancelVipSchema = z.object({ atPeriodEnd: z.boolean().default(true) })

// Adesão da loja ao selo: teto de desconto que ela banca e quem banca o frete.
export const vipMerchantSettingsSchema = z
  .object({
    discountEnabled: z.boolean(),
    discountCapPct: pct,
    fundsFreeDelivery: z.boolean(), // false = a plataforma banca o frete
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Envie ao menos um campo.')
export type VipMerchantSettingsInput = z.infer<typeof vipMerchantSettingsSchema>

// Webhook do gateway: acha a fatura por (provider, providerRef) e a marca como paga/falha.
export const vipWebhookSchema = z.object({
  provider: z.string().trim().min(1).max(20),
  providerRef: z.string().trim().min(1).max(200),
  status: z.enum(['PAID', 'FAILED']),
  paidAt: z.iso.datetime({ offset: true }).optional(),
})
export type VipWebhookInput = z.infer<typeof vipWebhookSchema>

// ---- DTOs de saída ---------------------------------------------------------------------------------

export interface VipTierDTO {
  minMonths: number
  discountPct: number
}

export interface VipPlanDTO {
  id: number
  code: string
  name: string
  priceMonthly: number
  freeDelivery: boolean
  freeDeliveryMinOrder: number
  active: boolean
  tiers: VipTierDTO[]
}

export interface VipSubscriptionDTO {
  id: string
  planId: number
  status: SubscriptionStatus
  startedAt: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  cancelledAt: string | null
  /** Desconto vigente hoje (faixa já alcançada); 0 se não for assinante ativo. */
  discountPct: number
}

export interface VipInvoiceDTO {
  id: string
  subscriptionId: string
  periodStart: string // YYYY-MM-DD
  periodEnd: string // YYYY-MM-DD
  amount: number
  status: InvoiceStatus
  provider: string | null
  providerRef: string | null
  paidAt: string | null
  createdAt: string
}

export interface VipMerchantDTO {
  merchantId: string
  discountEnabled: boolean
  discountCapPct: number
  fundsFreeDelivery: boolean
  enrolledAt: string
}

/** Situação do cliente no clube (GET /vip/me). */
export interface VipMeDTO {
  provider: string
  plan: VipPlanDTO | null
  subscription: VipSubscriptionDTO | null
  /** Fatura em aberto (PENDING) da assinatura, se houver. */
  pendingInvoice: VipInvoiceDTO | null
  /** Assinou mas ainda não pagou a 1ª fatura (assinatura PAST_DUE sem nenhum pagamento). */
  awaitingPayment: boolean
  /** Link de pagamento do provedor (Asaas), quando existir. */
  paymentUrl: string | null
  /** Mock em dev: a tela mostra "simular pagamento". */
  canSimulatePayment: boolean
}

export interface VipMerchantStatsDTO {
  orders: number
  customers: number
  totalSavings: number
}

/** Situação da loja no clube (GET /vip/merchant). */
export interface VipMerchantStateDTO {
  enrolled: boolean
  settings: VipMerchantDTO | null
  maxCapPct: number
  stats: VipMerchantStatsDTO
}
