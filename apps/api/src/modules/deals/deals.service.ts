import { randomInt } from 'node:crypto'
import type { AuthUser } from '../../shared/auth.js'
import { type Db, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import * as repo from './deals.repository.js'
import type { ListDealsQuery } from './deals.schema.js'
import type { ChainDTO, CouponDTO, DealDTO } from './deals.types.js'

// Sem 0/O/1/I: o código é lido em voz alta no caixa.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')

export const COUPON_TTL_HOURS = 24

const dealNotFound = () => new AppError(404, 'DEAL_NOT_FOUND', 'Oferta não encontrada ou já encerrada.')

export function createDealsService(deps: { db: Db }) {
  const { db } = deps

  const list = (query: ListDealsQuery): Promise<DealDTO[]> => repo.listDeals(db, query)
  const chains = (): Promise<ChainDTO[]> => repo.listChains(db)
  const myCoupons = (customer: AuthUser): Promise<CouponDTO[]> => repo.listCoupons(db, customer.id)

  async function get(id: string): Promise<DealDTO> {
    const deal = await repo.findDeal(db, id)
    if (!deal) throw dealNotFound()
    return deal
  }

  // Reserva a oferta para retirada no caixa. O preço fica gravado no cupom: a oferta é reescrita a cada varredura.
  async function claimCoupon(customer: AuthUser, dealId: string): Promise<CouponDTO> {
    return withTransaction(db, async (tx) => {
      const deal = await repo.findDeal(tx, dealId)
      if (!deal) throw dealNotFound()
      if (!deal.couponEligible) {
        throw new AppError(422, 'DEAL_NOT_COUPON_ELIGIBLE', 'Esta oferta não gera cupom (desconto menor que 15% ou sem preço de referência).')
      }
      await repo.expireCoupons(tx, customer.id, dealId)

      // Colisão de código é improvável (32^8); tenta de novo em vez de falhar o pedido.
      for (let attempt = 0; attempt < 5; attempt++) {
        await tx.query('SAVEPOINT claim')
        try {
          const id = await repo.insertCoupon(tx, {
            code: newCode(),
            dealId,
            customerId: customer.id,
            productName: deal.productName,
            unitPrice: deal.discountPrice,
            minQty: deal.wholesaleMinQty,
            ttlHours: COUPON_TTL_HOURS,
          })
          return await repo.findCoupon(tx, id)
        } catch (err) {
          await tx.query('ROLLBACK TO SAVEPOINT claim')
          const constraint = (err as { constraint?: string }).constraint
          if (constraint === 'uq_coupons_active') {
            throw new AppError(409, 'COUPON_ALREADY_ACTIVE', 'Você já tem um cupom ativo para esta oferta.')
          }
          if (constraint !== 'deal_coupons_code_key') throw err
        }
      }
      throw new AppError(500, 'COUPON_CODE_FAILED', 'Não foi possível gerar o cupom. Tente novamente.')
    })
  }

  return { list, get, chains, myCoupons, claimCoupon }
}

export type DealsService = ReturnType<typeof createDealsService>
