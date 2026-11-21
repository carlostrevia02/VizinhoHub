import type { DbClient } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

// Prato do dia: a porção é baixada NA CRIAÇÃO do pedido (como a oferta relâmpago), de forma atômica.
//   UPDATE daily_menu SET qty_available = qty_available - q
//    WHERE product_id = p AND menu_date = current_date AND is_on AND qty_available >= q
// Voltam no ROLLBACK ou no cancelamento. O limite é das porções do dia (da oferta), não do produto.

export async function claimDailyMenu(tx: DbClient, lines: { productId: string; quantity: number }[]): Promise<void> {
  if (!lines.length) return
  const { rows: kinds } = await tx.query<{ id: string }>(`SELECT id FROM products WHERE id = ANY($1::uuid[]) AND kind = 'DAILY_SPECIAL'`, [lines.map((l) => l.productId)])
  const daily = new Set(kinds.map((k) => k.id))
  const shortages: { productId: string; requested: number; available: number }[] = []
  // Ordem fixa por produto: dois pedidos simultâneos nunca se travam mutuamente.
  for (const line of lines.filter((l) => daily.has(l.productId)).sort((a, b) => a.productId.localeCompare(b.productId))) {
    const { rowCount } = await tx.query(
      `UPDATE daily_menu SET qty_available = qty_available - $2::int, updated_at = now()
        WHERE product_id = $1 AND menu_date = current_date AND is_on AND qty_available >= $2::int`,
      [line.productId, line.quantity],
    )
    if (rowCount === 0) {
      const { rows } = await tx.query<{ available: number }>(`SELECT daily_available($1) AS available`, [line.productId])
      shortages.push({ productId: line.productId, requested: line.quantity, available: rows[0]?.available ?? 0 })
    }
  }
  if (shortages.length) throw new AppError(422, 'DAILY_UNAVAILABLE', 'Prato do dia esgotado ou desligado.', { shortages })
}

/** Cancelamento: devolve as porções ao cardápio do dia em que o pedido foi feito (nunca passa do total). */
export async function releaseDailyMenu(tx: DbClient, orderId: string): Promise<void> {
  await tx.query(
    `UPDATE daily_menu d SET qty_available = LEAST(d.qty_total, d.qty_available + oi.quantity), updated_at = now()
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id AND p.kind = 'DAILY_SPECIAL'
      WHERE oi.order_id = $1 AND d.product_id = oi.product_id AND d.menu_date = (o.created_at AT TIME ZONE 'America/Fortaleza')::date`,
    [orderId],
  )
}
