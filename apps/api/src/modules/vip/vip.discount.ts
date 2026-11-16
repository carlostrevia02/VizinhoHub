import { type Db, type DbClient, fromCents, toCents } from '../../shared/db.js'

// Desconto do Clube VIP aplicado no pedido (chamado por orders.service dentro da transação do pedido).
// Quem banca é o lojista que aderiu (vip_merchants): vale o MENOR entre a faixa do cliente (vip_discount_pct) e o
// teto da loja. A plataforma não subsidia. Frete grátis é por adesão da loja (vip_merchants.funds_free_delivery):
// veja vipFreeDelivery, chamada pelo pedido com entrega.

/** Percentual efetivo: 0 se o cliente não é VIP ativo, a loja não aderiu ou desligou o desconto. */
export async function vipDiscountPctFor(tx: Db | DbClient, customerId: string, merchantId: string): Promise<number> {
  const { rows } = await tx.query<{ pct: string }>(
    `SELECT least(vip_discount_pct($1), m.discount_cap_pct)::text AS pct
       FROM vip_merchants m WHERE m.merchant_id = $2 AND m.discount_enabled`,
    [customerId, merchantId],
  )
  return Number(rows[0]?.pct ?? 0)
}

export interface VipLine {
  unitPrice: string
  quantity: number
  flashOfferId: string | null
}

/**
 * Devolve as linhas com o preço unitário já descontado e quanto o cliente economizou.
 * Itens de oferta relâmpago (flashOfferId) ficam de fora: o preço relâmpago já é o desconto.
 */
export function applyVipPct<L extends VipLine>(lines: L[], pct: number): { lines: L[]; total: string; savings: number } {
  const permille = Math.round(pct * 10) // NUMERIC(4,1): uma casa decimal
  let savedCents = 0
  const out = lines.map((l) => {
    if (permille <= 0 || l.flashOfferId) return l
    const cents = toCents(l.unitPrice)
    const discounted = Math.round((cents * (1000 - permille)) / 1000)
    savedCents += (cents - discounted) * l.quantity
    return { ...l, unitPrice: fromCents(discounted).toFixed(2) }
  })
  const totalCents = out.reduce((sum, l) => sum + toCents(l.unitPrice) * l.quantity, 0)
  return { lines: out, total: fromCents(totalCents).toFixed(2), savings: fromCents(savedCents) }
}

export async function applyVipDiscount<L extends VipLine>(tx: DbClient, customerId: string, merchantId: string, lines: L[]) {
  return applyVipPct(lines, await vipDiscountPctFor(tx, customerId, merchantId))
}

/**
 * Frete grátis do Clube VIP (decisão de 16/11/2026: custeado pelo lojista por adesão). Vale só com as três
 * condições: assinatura ACTIVE no período, plano com free_delivery e pedido acima do mínimo do plano, e loja
 * aderente que banca o frete (funds_free_delivery). Sem a adesão da loja não há frete grátis: a plataforma não banca.
 */
export async function vipFreeDelivery(tx: Db | DbClient, customerId: string, merchantId: string, orderTotal: string): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1
       FROM vip_subscriptions s
       JOIN vip_plans p ON p.id = s.plan_id
       JOIN vip_merchants m ON m.merchant_id = $2 AND m.funds_free_delivery
      WHERE s.user_id = $1 AND s.status = 'ACTIVE' AND s.current_period_end > now()
        AND p.free_delivery AND $3::numeric >= coalesce(p.free_delivery_min_order, 0)
      LIMIT 1`,
    [customerId, merchantId, orderTotal],
  )
  return rows.length > 0
}

export async function recordVipSavings(tx: DbClient, orderId: string, savings: number): Promise<void> {
  if (savings > 0) await tx.query(`UPDATE orders SET vip_savings = $2 WHERE id = $1`, [orderId, savings.toFixed(2)])
}
