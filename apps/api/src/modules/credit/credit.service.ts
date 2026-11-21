import type { CreditReminderDTO, CreateCreditAccountInput, ListCreditCandidatesQuery, RegisterPaymentInput } from '@vizinhohub/contracts/credit'
import type { z } from 'zod'
import type { updateCreditAccountSchema, adjustmentSchema, listCreditAccountsSchema } from '@vizinhohub/contracts/credit'
import type { AuthUser } from '../../shared/auth.js'
import { type Db, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import * as ledger from './credit.ledger.js'
import { buildPixPayload } from './credit.pix.js'
import * as repo from './credit.repository.js'

const notFound = () => new AppError(404, 'CREDIT_ACCOUNT_NOT_FOUND', 'Conta da caderneta não encontrada.')
export const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

// Telefone brasileiro para o wa.me: só dígitos, com DDI 55.
export function whatsappPhone(phone: string | null): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.length <= 11 ? `55${digits}` : digits
}

// Texto do lembrete + link do WhatsApp + Pix copia e cola da chave do próprio lojista (função pura).
export function buildReminder(args: {
  accountId: string
  customerName: string
  customerPhone: string | null
  storeName: string
  city: string
  pixKey: string | null
  amount: number
}): CreditReminderDTO {
  const pix = args.pixKey ? buildPixPayload({ key: args.pixKey, merchantName: args.storeName, city: args.city, amount: args.amount }) : null
  const first = args.customerName.split(' ')[0]
  const text =
    `Olá, ${first}! Aqui é da ${args.storeName}. Passando para lembrar do seu saldo na caderneta: ${brl(args.amount)}.` +
    (pix ? `\n\nSe preferir, pague por Pix (copia e cola):\n${pix}` : '') +
    `\n\nQualquer dúvida é só chamar. Obrigado!`
  const phone = whatsappPhone(args.customerPhone)
  return { accountId: args.accountId, amount: args.amount, text, pixCopyPaste: pix, whatsappUrl: `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}` }
}

export function createCreditService(deps: { db: Db }) {
  const { db } = deps

  // Conta da loja do lojista logado; de outra loja = 404 (não revela que existe).
  async function ownedAccount(merchant: AuthUser, id: string) {
    const account = await repo.findAccount(db, id)
    if (!account || account.merchantId !== merchant.id) throw notFound()
    return account
  }

  const listForMerchant = (merchant: AuthUser, q: z.infer<typeof listCreditAccountsSchema>) => repo.listAccounts(db, { merchantId: merchant.id, ...q })
  const listMine = (customer: AuthUser) => repo.listAccounts(db, { customerId: customer.id })
  const candidates = (merchant: AuthUser, q: ListCreditCandidatesQuery = { limit: 50 }) => repo.listCandidates(db, merchant.id, q)

  async function createAccount(merchant: AuthUser, input: CreateCreditAccountInput) {
    const { rows } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'CUSTOMER'`, [input.customerId])
    if (!rows[0]) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Cliente não encontrado.')
    try {
      const id = await repo.insertAccount(db, { merchantId: merchant.id, customerId: input.customerId, creditLimit: input.creditLimit, settlementDay: input.settlementDay })
      return (await repo.findAccount(db, id))!
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new AppError(409, 'CREDIT_ACCOUNT_EXISTS', 'Este cliente já tem caderneta na sua loja.')
      throw err
    }
  }

  async function updateAccount(merchant: AuthUser, id: string, patch: z.infer<typeof updateCreditAccountSchema>) {
    return withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ balance: string }>(`SELECT balance::text FROM credit_accounts WHERE id = $1 AND merchant_id = $2 FOR UPDATE`, [id, merchant.id])
      if (!rows[0]) throw notFound()
      if (patch.status === 'CLOSED' && Number(rows[0].balance) > 0) throw new AppError(422, 'ACCOUNT_HAS_DEBT', 'Quite a dívida antes de encerrar a caderneta.')
      const sets: string[] = []
      const params: unknown[] = [id]
      const add = (col: string, v: unknown) => {
        params.push(v)
        sets.push(`${col} = $${params.length}`)
      }
      if (patch.creditLimit !== undefined) add('credit_limit', patch.creditLimit)
      if (patch.status !== undefined) add('status', patch.status)
      if (patch.settlementDay !== undefined) add('settlement_day', patch.settlementDay)
      await tx.query(`UPDATE credit_accounts SET ${sets.join(', ')} WHERE id = $1`, params)
      return (await repo.findAccount(tx, id))!
    })
  }

  // Extrato: o lojista da conta ou o cliente dono dela.
  async function ledgerOf(user: AuthUser, id: string, limit = 100) {
    const account = await repo.findAccount(db, id)
    const mine = user.role === 'MERCHANT' ? account?.merchantId === user.id : account?.customer.id === user.id
    if (!account || !mine) throw notFound()
    return { account, entries: await repo.listLedger(db, id, limit) }
  }

  async function pay(merchant: AuthUser, id: string, input: RegisterPaymentInput) {
    await withTransaction(db, (tx) => ledger.registerPayment(tx, { accountId: id, merchantId: merchant.id, userId: merchant.id, ...input }))
    return (await repo.findAccount(db, id))!
  }

  async function adjust(merchant: AuthUser, id: string, input: z.infer<typeof adjustmentSchema>) {
    await withTransaction(db, (tx) => ledger.registerAdjustment(tx, { accountId: id, merchantId: merchant.id, userId: merchant.id, ...input }))
    return (await repo.findAccount(db, id))!
  }

  async function reminder(merchant: AuthUser, id: string): Promise<CreditReminderDTO> {
    const account = await ownedAccount(merchant, id)
    if (account.balance <= 0) throw new AppError(422, 'NOTHING_OWED', 'Este cliente não tem saldo em aberto.')
    const billing = (await repo.findMerchantBilling(db, merchant.id))!
    const dto = buildReminder({
      accountId: id,
      customerName: account.customer.name,
      customerPhone: account.customer.phone,
      storeName: billing.name,
      city: billing.city,
      pixKey: billing.pix_key,
      amount: account.balance,
    })
    await repo.touchReminder(db, id)
    return dto
  }

  return { listForMerchant, listMine, candidates, createAccount, updateAccount, ledgerOf, pay, adjust, reminder }
}

export type CreditService = ReturnType<typeof createCreditService>
