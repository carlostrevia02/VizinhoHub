// Retenção: funil (store_events, 90 dias) e pedidos (5 anos com dependentes). Datas antigas são simuladas
// com UPDATE de created_at para o passado; as funções são chamadas direto, sem esperar o job.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { purgeStoreEvents } from '../src/modules/ops/ops.jobs.js'
import { ORDER_DEPENDENT_TABLES, purgeOldOrders } from '../src/modules/orders/orders.retention.js'
import { CREME, MARIA, ZE, startTestEnv, type TestEnv } from './helpers.js'

let t: TestEnv
before(async () => {
  t = await startTestEnv()
})
after(() => t?.stop())

const count = async (sql: string, params: unknown[]) => Number((await t.db.query(sql, params)).rows[0].n)

/** Pedido com `ageDays` dias de idade (created_at ajustado para o passado). */
async function pedido(ageDays: number) {
  const { rows } = await t.db.query(`INSERT INTO orders (customer_id, merchant_id, total_price) VALUES ($1, $2, 10) RETURNING id`, [MARIA, ZE])
  const id = rows[0].id as string
  await t.db.query(`UPDATE orders SET created_at = now() - make_interval(days => $2) WHERE id = $1`, [id, ageDays])
  return id
}

describe('retenção do funil (store_events, 90 dias)', () => {
  it('apaga eventos com mais de 90 dias e mantém 89 dias e os recentes', async () => {
    const velho = randomUUID()
    const limite = randomUUID()
    const novo = randomUUID()
    for (const [session, days] of [[velho, 91], [limite, 89], [novo, 0]] as const) {
      await t.db.query(
        `INSERT INTO store_events (merchant_id, session_id, type, created_at) VALUES ($1, $2, 'STORE_VIEW', now() - make_interval(days => $3))`,
        [ZE, session, days],
      )
    }
    await purgeStoreEvents(t.db)
    const sobra = await count(`SELECT count(*)::int AS n FROM store_events WHERE session_id = ANY($1::uuid[])`, [[velho, limite, novo]])
    assert.equal(sobra, 2)
    assert.equal(await count(`SELECT count(*)::int AS n FROM store_events WHERE session_id = $1`, [velho]), 0)
    assert.equal(await count(`SELECT count(*)::int AS n FROM store_events WHERE session_id = $1`, [limite]), 1)
  })
})

describe('retenção de pedidos (5 anos)', () => {
  it('as tabelas com FK para orders são exatamente as que a rotina conhece', async () => {
    const { rows } = await t.db.query(
      `SELECT DISTINCT conrelid::regclass::text AS tabela FROM pg_constraint WHERE contype = 'f' AND confrelid = 'orders'::regclass ORDER BY 1`,
    )
    assert.deepEqual(rows.map((r) => r.tabela), [...ORDER_DEPENDENT_TABLES].sort())
  })

  it('apaga o pedido velho com dependentes; mantém o que tem lançamento na caderneta, o de 4 anos e o recente', async () => {
    // Pedido velho (6 anos) com todos os dependentes: itens, impressão, entrega com oferta e GPS, movimento do antigo livro de estoque.
    const velho = await pedido(365 * 6)
    await t.db.query(`INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, 1, 4.29)`, [velho, CREME])
    await t.db.query(`INSERT INTO print_jobs (merchant_id, order_id, kind) VALUES ($1, $2, 'TICKET')`, [ZE, velho])
    const { rows: d } = await t.db.query(
      `INSERT INTO deliveries (order_id, merchant_id, pin_code, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
       VALUES ($1, $2, '4821', -3.7371, -38.496, -3.7398, -38.496) RETURNING id`,
      [velho, ZE],
    )
    await t.db.query(`INSERT INTO couriers (user_id, vehicle, neighborhood, city, approved) VALUES ($1, 'MOTO', 'Aldeota', 'Fortaleza', TRUE)`, [MARIA])
    await t.db.query(`INSERT INTO delivery_offers (delivery_id, courier_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [d[0].id, MARIA])
    await t.db.query(`INSERT INTO courier_location_log (delivery_id, lat, lng) VALUES ($1, -3.7371, -38.496)`, [d[0].id])
    await t.db.query(`INSERT INTO stock_movements (product_id, merchant_id, delta, stock_after, reason, order_id) VALUES ($1, $2, -1, 23, 'SALE', $3)`, [CREME, ZE, velho])

    // Pedido velho COM lançamento na caderneta: o livro financeiro não se apaga.
    const comFiado = await pedido(365 * 6)
    const { rows: acc } = await t.db.query(`INSERT INTO credit_accounts (merchant_id, customer_id, credit_limit) VALUES ($1, $2, 100) RETURNING id`, [ZE, MARIA])
    await t.db.query(`INSERT INTO credit_ledger (account_id, kind, amount, balance_after, order_id) VALUES ($1, 'CHARGE', 10, 10, $2)`, [acc[0].id, comFiado])
    await t.db.query(`UPDATE credit_accounts SET balance = 10 WHERE id = $1`, [acc[0].id])

    const quatroAnos = await pedido(365 * 4)
    const recente = await pedido(1)

    const removidos = await purgeOldOrders(t.db)
    assert.equal(removidos, 1)

    const existe = async (id: string) => (await count(`SELECT count(*)::int AS n FROM orders WHERE id = $1`, [id])) === 1
    assert.equal(await existe(velho), false)
    assert.equal(await existe(comFiado), true)
    assert.equal(await existe(quatroAnos), true)
    assert.equal(await existe(recente), true)

    assert.equal(await count(`SELECT count(*)::int AS n FROM order_items WHERE order_id = $1`, [velho]), 0)
    assert.equal(await count(`SELECT count(*)::int AS n FROM print_jobs WHERE order_id = $1`, [velho]), 0)
    assert.equal(await count(`SELECT count(*)::int AS n FROM deliveries WHERE order_id = $1`, [velho]), 0)
    assert.equal(await count(`SELECT count(*)::int AS n FROM delivery_offers WHERE delivery_id = $1`, [d[0].id]), 0)
    assert.equal(await count(`SELECT count(*)::int AS n FROM courier_location_log WHERE delivery_id = $1`, [d[0].id]), 0)
    // O antigo livro de estoque (tabela legada) fica; só perde o vínculo com o pedido apagado (ON DELETE SET NULL).
    assert.equal(await count(`SELECT count(*)::int AS n FROM stock_movements WHERE order_id IS NULL AND product_id = $1 AND delta = -1 AND stock_after = 23`, [CREME]), 1)
  })
})
