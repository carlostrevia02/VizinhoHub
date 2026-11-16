import type { DbClient } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

// Baixas atômicas da Oferta Relâmpago. Chamadas pelo módulo de pedidos DENTRO da transação do pedido:
// qualquer falha dá ROLLBACK e todas as baixas voltam juntas.
//
// Ordem fixa (evita deadlock): 1) saldo da oferta  2) limite por cliente  3) estoque do produto (feito pelo pedido).
// O UPDATE condicional é o próprio lock: o banco decide sem ler-e-gravar.

export interface FlashClaim {
  offerId: string
  productId: string
  merchantId: string
  quantity: number
  /** Preço da oferta, NUMERIC como string. */
  unitPrice: string
}

export async function claimOffers(tx: DbClient, customerId: string, items: { flashOfferId: string; quantity: number }[]): Promise<FlashClaim[]> {
  // A mesma oferta repetida no pedido vira uma linha só.
  const wanted = new Map<string, number>()
  for (const i of items) wanted.set(i.flashOfferId, (wanted.get(i.flashOfferId) ?? 0) + i.quantity)

  const claims: FlashClaim[] = []
  for (const [offerId, quantity] of [...wanted].sort(([a], [b]) => a.localeCompare(b))) {
    // 1) saldo da oferta (e janela de tempo) — 0 linhas = esgotou, expirou ou foi cancelada
    const offer = await tx.query<{ product_id: string; merchant_id: string; offer_price: string }>(
      `UPDATE flash_offers
          SET qty_available = qty_available - $2::int,
              status = CASE WHEN qty_available - $2::int = 0 THEN 'SOLD_OUT' ELSE status END
        WHERE id = $1 AND status = 'ACTIVE' AND qty_available >= $2::int AND now() >= starts_at AND now() < ends_at
    RETURNING product_id, merchant_id, offer_price::text AS offer_price`,
      [offerId, quantity],
    )
    if (!offer.rows[0]) throw new AppError(422, 'FLASH_UNAVAILABLE', 'Esta oferta relâmpago acabou ou expirou.', { offerId })

    // 2) limite por cliente — INSERT ... ON CONFLICT ... WHERE (0 linhas = passou do limite)
    const claim = await tx.query(
      `INSERT INTO flash_offer_claims (offer_id, customer_id, qty)
       SELECT id, $2, $3::int FROM flash_offers WHERE id = $1 AND $3::int <= max_per_customer
       ON CONFLICT (offer_id, customer_id) DO UPDATE
          SET qty = flash_offer_claims.qty + $3::int, updated_at = now()
        WHERE flash_offer_claims.qty + $3::int <= (SELECT max_per_customer FROM flash_offers WHERE id = $1)
    RETURNING qty`,
      [offerId, customerId, quantity],
    )
    if (claim.rowCount === 0) throw new AppError(422, 'FLASH_LIMIT', 'Você já pegou o máximo desta oferta por cliente.', { offerId })

    const o = offer.rows[0]
    claims.push({ offerId, productId: o.product_id, merchantId: o.merchant_id, quantity, unitPrice: o.offer_price })
  }
  return claims
}

/** Cancelamento do pedido: devolve o saldo da oferta e o limite do cliente (o estoque volta pelo livro). */
export async function releaseOffers(tx: DbClient, customerId: string | null, lines: { flashOfferId: string; quantity: number }[]): Promise<void> {
  for (const { flashOfferId, quantity } of [...lines].sort((a, b) => a.flashOfferId.localeCompare(b.flashOfferId))) {
    await tx.query(
      `UPDATE flash_offers
          SET qty_available = LEAST(qty_total, qty_available + $2::int),
              status = CASE WHEN status = 'SOLD_OUT' AND now() < ends_at THEN 'ACTIVE' ELSE status END
        WHERE id = $1`,
      [flashOfferId, quantity],
    )
    if (customerId) {
      await tx.query(
        `UPDATE flash_offer_claims SET qty = GREATEST(0, qty - $3::int), updated_at = now() WHERE offer_id = $1 AND customer_id = $2`,
        [flashOfferId, customerId, quantity],
      )
    }
  }
}
