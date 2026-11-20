import { randomInt } from 'node:crypto'
import type { AuthUser } from '../../shared/auth.js'
import { type Db, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import { createBranchesService } from '../branches/branches.service.js'
import type { BranchDTO, NearestBranchDTO } from '../branches/branches.types.js'
import type { LatLng, Router } from '../branches/routing.js'
import * as repo from './deals.repository.js'
import type { DealLocationQuery, ListDealsQuery } from './deals.schema.js'
import type { ChainDTO, CouponDTO, DealDTO, DealRow } from './deals.types.js'

// Sem 0/O/1/I: o código é lido em voz alta no caixa.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')

export const COUPON_TTL_HOURS = 24

const dealNotFound = () => new AppError(404, 'DEAL_NOT_FOUND', 'Oferta não encontrada ou já encerrada.')

// Chave de "mesma loja" para dividir o cálculo de rota: rede + bairro da oferta, sem acento nem caixa.
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const branchKey = (d: DealRow) => `${d.chain.id}|${d.neighborhood ? plain(d.neighborhood) : ''}`

export function createDealsService(deps: { db: Db; router?: Router }) {
  const { db } = deps
  const branches = createBranchesService({ db, router: deps.router })

  // Com a localização do cliente, anexa a filial mais próxima. Uma consulta por (rede, bairro da oferta) em cada
  // requisição: ofertas da mesma loja reaproveitam a mesma promessa. Sem localização, nearestBranch = null.
  async function withBranches(rows: DealRow[], where: { lat?: number; lng?: number }): Promise<DealDTO[]> {
    if (where.lat === undefined || where.lng === undefined) return rows.map((r) => ({ ...r, nearestBranch: null }))
    const origin: LatLng = { lat: where.lat, lng: where.lng }
    const pending = new Map<string, Promise<NearestBranchDTO | null>>()
    for (const row of rows) {
      const key = branchKey(row)
      if (!pending.has(key)) pending.set(key, branches.nearestBranch(row.chain.id, origin, { neighborhood: row.neighborhood }))
    }
    const found = new Map(await Promise.all([...pending].map(async ([key, p]) => [key, await p] as const)))
    return rows.map((r) => ({ ...r, nearestBranch: found.get(branchKey(r)) ?? null }))
  }

  const list = async (query: ListDealsQuery): Promise<DealDTO[]> => withBranches(await repo.listDeals(db, query), query)
  const chainBranches = (slug: string): Promise<BranchDTO[]> => branches.listByChain(slug)
  const chains = (): Promise<ChainDTO[]> => repo.listChains(db)
  const myCoupons = (customer: AuthUser): Promise<CouponDTO[]> => repo.listCoupons(db, customer.id)

  async function get(id: string, where: DealLocationQuery = {}): Promise<DealDTO> {
    const deal = await repo.findDeal(db, id)
    if (!deal) throw dealNotFound()
    return (await withBranches([deal], where))[0]!
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
            originalPrice: deal.originalPrice ?? deal.discountPrice, // elegível a cupom sempre tem "de"; defensivo: sem "de", lucro zero
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

  // Compra confirmada = o próprio cliente confirma no cupom; só então vira venda e lucro.
  async function confirmCoupon(customer: AuthUser, couponId: string): Promise<CouponDTO> {
    if (await repo.confirmCoupon(db, couponId, customer.id)) return repo.findCoupon(db, couponId)

    const state = await repo.findCouponState(db, couponId, customer.id)
    if (!state) throw new AppError(404, 'COUPON_NOT_FOUND', 'Cupom não encontrado.')
    if (state.status === 'REDEEMED') throw new AppError(409, 'COUPON_ALREADY_CONFIRMED', 'Este cupom já teve a compra confirmada.')
    throw new AppError(409, 'COUPON_EXPIRED', 'Este cupom venceu e não pode mais ser confirmado.')
  }

  return { list, get, chains, chainBranches, myCoupons, claimCoupon, confirmCoupon }
}

export type DealsService = ReturnType<typeof createDealsService>
