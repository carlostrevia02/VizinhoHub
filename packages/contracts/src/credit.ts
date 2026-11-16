import { z } from 'zod'
import { money, moneyNonNeg, uuid } from './common.js'

// Módulo 008 · Caderneta Digital / fiado (db/migrations/008-caderneta-encomendas-combos.sql).
// balance = quanto o cliente DEVE. CHARGE soma; PAYMENT subtrai.

export const CREDIT_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const
export const LEDGER_KINDS = ['CHARGE', 'PAYMENT', 'ADJUSTMENT'] as const
export type CreditStatus = (typeof CREDIT_STATUSES)[number]
export type LedgerKind = (typeof LEDGER_KINDS)[number]

// NUMERIC(10,2): máx. 99.999.999,99.
const MAX = 99_999_999.99

// ---- Entradas -------------------------------------------------------------------------------------

export const createCreditAccountSchema = z.object({
  customerId: uuid,
  creditLimit: moneyNonNeg(MAX).default(0),
  settlementDay: z.number().int().min(1).max(28).nullish(), // dia combinado do acerto
})
export type CreateCreditAccountInput = z.infer<typeof createCreditAccountSchema>

// O limite pode ficar abaixo da dívida atual (não há CHECK no SQL de propósito).
export const updateCreditAccountSchema = z
  .object({
    creditLimit: moneyNonNeg(MAX),
    status: z.enum(CREDIT_STATUSES),
    settlementDay: z.number().int().min(1).max(28).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Envie ao menos um campo.')

// Lança um pedido na caderneta (um pedido só pode ser cobrado uma vez).
export const chargeOrderSchema = z.object({ orderId: uuid })

// Pagamento: valor positivo na entrada; o ledger grava com sinal negativo.
export const registerPaymentSchema = z.object({
  amount: money(MAX),
  paymentMethod: z.string().trim().min(1).max(20).optional(),
  note: z.string().trim().min(1).max(500).optional(),
})
export type RegisterPaymentInput = z.infer<typeof registerPaymentSchema>

// Ajuste manual: valor com sinal, diferente de zero; a justificativa é obrigatória.
export const adjustmentSchema = z.object({
  amount: z
    .number()
    .min(-MAX)
    .max(MAX)
    .refine((v) => v !== 0, 'O valor não pode ser 0.')
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use no máximo 2 casas decimais.'),
  note: z.string().trim().min(1).max(500),
})

export const listCreditAccountsSchema = z.object({
  owing: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), // true = só quem deve
  status: z.enum(CREDIT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

// ---- DTOs de saída ---------------------------------------------------------------------------------

export interface CreditAccountDTO {
  id: string
  merchantId: string
  customer: { id: string; name: string; phone: string | null }
  merchant: { id: string; name: string }
  creditLimit: number
  balance: number // dívida atual (>= 0)
  available: number // max(creditLimit - balance, 0)
  status: CreditStatus
  settlementDay: number | null
  lastReminderAt: string | null
  createdAt: string
}

/** Lembrete de cobrança: texto pronto, link do WhatsApp e o "Pix copia e cola" da chave do próprio lojista. */
export interface CreditReminderDTO {
  accountId: string
  amount: number
  text: string
  whatsappUrl: string
  pixCopyPaste: string | null // null = o lojista ainda não cadastrou a chave Pix
}

/** Cliente da loja que ainda não tem conta na caderneta (candidato a abrir conta). */
export interface CreditCandidateDTO {
  id: string
  name: string
  phone: string | null
  orders: number
}

export interface LedgerEntryDTO {
  id: number
  accountId: string
  kind: LedgerKind
  amount: number // com sinal: CHARGE > 0, PAYMENT < 0
  balanceAfter: number
  orderId: string | null
  paymentMethod: string | null
  note: string | null
  createdAt: string
}
