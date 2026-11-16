import { withTransaction, type Db } from '../../shared/db.js'

// Retenção de pedidos: 5 anos (obrigação fiscal/prescrição; decisão em doc 10, seção 8).
export const ORDER_RETENTION_YEARS = 5
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Tabelas com FK para orders, conferidas em pg_constraint pelo teste de retenção.
 * - deliveries, print_jobs, order_items: ON DELETE CASCADE. Aqui são apagadas explicitamente, filhos antes do pedido.
 * - stock_movements: ON DELETE SET NULL. O livro de estoque fica e só perde o vínculo com o pedido.
 * - credit_ledger: sem ação em cascata e só insere (livro financeiro). Pedido com lançamento na caderneta é pulado.
 */
export const ORDER_DEPENDENT_TABLES = ['credit_ledger', 'deliveries', 'order_items', 'print_jobs', 'stock_movements'] as const

/** Apaga, numa transação, pedidos com mais de `years` anos e os dependentes. Devolve quantos pedidos saíram. */
export async function purgeOldOrders(db: Db, years = ORDER_RETENTION_YEARS): Promise<number> {
  return withTransaction(db, async (c) => {
    // FOR UPDATE: um lançamento na caderneta que chegue agora espera o COMMIT em vez de quebrar a FK.
    const { rows } = await c.query<{ id: string }>(
      `SELECT o.id FROM orders o
        WHERE o.created_at < now() - make_interval(years => $1)
          AND NOT EXISTS (SELECT 1 FROM credit_ledger l WHERE l.order_id = o.id)
        FOR UPDATE OF o`,
      [years],
    )
    if (rows.length === 0) return 0
    const ids = rows.map((r) => r.id)
    await c.query(`DELETE FROM courier_location_log WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_id = ANY($1::uuid[]))`, [ids])
    await c.query(`DELETE FROM delivery_offers WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_id = ANY($1::uuid[]))`, [ids])
    await c.query(`DELETE FROM deliveries WHERE order_id = ANY($1::uuid[])`, [ids])
    await c.query(`DELETE FROM print_jobs WHERE order_id = ANY($1::uuid[])`, [ids])
    await c.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [ids])
    const { rowCount } = await c.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids])
    return rowCount ?? 0
  })
}

// Roda ao subir e depois a cada 24 h; o timer não segura o processo aberto.
export function startOrdersRetentionJob(db: Db, intervalMs = DAY_MS) {
  const run = async () => {
    try {
      const removed = await purgeOldOrders(db)
      if (removed > 0) console.log(`Retenção: ${removed} pedido(s) com mais de ${ORDER_RETENTION_YEARS} anos apagado(s).`)
    } catch (err) {
      console.error('Falha no job de retenção de pedidos', err)
    }
  }
  void run()
  const timer = setInterval(run, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
