// Migrações 004–009 (logística, operação, ofertas relâmpago, carrinho inteligente, caderneta/encomendas/combos, VIP):
// aplicam em cima do schema atual, são idempotentes e os padrões de baixa atômica resistem a concorrência de verdade
// (30 transações simultâneas no Postgres embutido).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { withTransaction } from '../src/shared/db.js'
import { CREME, LUCIA, MARIA, startTestEnv, ZE, type TestEnv } from './helpers.js'

const MIGRATIONS = path.resolve(import.meta.dirname, '../../../db/migrations')
const NEW_MIGRATIONS = fs.readdirSync(MIGRATIONS).filter((f) => /^00[4-9]-.*\.sql$/.test(f)).sort()

let t: TestEnv
before(async () => {
  t = await startTestEnv()
  // Duas vezes: a segunda prova a idempotência (é o que `npm run migrate` faz em bancos já migrados).
  for (let i = 0; i < 2; i++) {
    for (const f of NEW_MIGRATIONS) await t.db.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  }
})
after(() => t?.stop())

/** Dispara N operações ao mesmo tempo e conta quantas deram certo (`true`). */
const race = async (n: number, op: (i: number) => Promise<boolean>) => (await Promise.all(Array.from({ length: n }, (_, i) => op(i)))).filter(Boolean).length

async function newCustomer(i: number) {
  const { rows } = await t.db.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', 'CUSTOMER') RETURNING id`,
    [`Cliente ${i}`, `cliente${i}-${Math.random().toString(36).slice(2)}@vizinhohub.test`],
  )
  return rows[0].id as string
}

describe('migrações 004–009', () => {
  it('existem seis arquivos e todos aplicaram duas vezes sem erro', () => {
    assert.equal(NEW_MIGRATIONS.length, 6)
  })

  it('cria as tabelas esperadas', async () => {
    const { rows } = await t.db.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [['store_delivery_config', 'couriers', 'deliveries', 'delivery_offers', 'courier_location_log', 'store_events', 'print_jobs',
        'push_subscriptions', 'stock_movements', 'flash_offers', 'flash_offer_claims', 'offer_alert_subscriptions', 'offer_notifications',
        'canonical_products', 'recipes', 'recipe_ingredients', 'shopping_lists', 'shopping_list_items', 'credit_accounts', 'credit_ledger',
        'pickup_slots', 'slot_bookings', 'combo_items', 'daily_menu', 'vip_plans', 'vip_tiers', 'vip_subscriptions', 'vip_invoices', 'vip_merchants']],
    )
    assert.equal(rows[0].n, 29)
  })
})

describe('ofertas relâmpago: sem venda duplicada', () => {
  // Os dois passos da oferta documentados em 006-ofertas-relampago.sql (saldo da oferta e limite por cliente), na ordem que evita deadlock.
  async function claim(offerId: string, customerId: string, qty: number, limit: number) {
    try {
      await withTransaction(t.db, async (c) => {
        const o = await c.query(
          `UPDATE flash_offers SET qty_available = qty_available - $2
            WHERE id = $1 AND status = 'ACTIVE' AND qty_available >= $2 AND now() >= starts_at AND now() < ends_at`,
          [offerId, qty],
        )
        if (o.rowCount === 0) throw new Error('ESGOTADA')
        const k = await c.query(
          `INSERT INTO flash_offer_claims (offer_id, customer_id, qty) VALUES ($1, $2, $3)
           ON CONFLICT (offer_id, customer_id) DO UPDATE SET qty = flash_offer_claims.qty + $3, updated_at = now()
             WHERE flash_offer_claims.qty + $3 <= $4`,
          [offerId, customerId, qty, limit],
        )
        if (k.rowCount === 0) throw new Error('LIMITE')
      })
      return true
    } catch {
      return false
    }
  }

  it('30 clientes disputam 5 unidades: vendem exatamente 5', async () => {
    const { rows } = await t.db.query(
      `INSERT INTO flash_offers (merchant_id, product_id, original_price, offer_price, qty_total, qty_available, ends_at)
       VALUES ($1, $2, 4.29, 2.00, 5, 5, now() + interval '1 hour') RETURNING id`,
      [ZE, CREME],
    )
    const offer = rows[0].id as string
    const customers = await Promise.all(Array.from({ length: 30 }, (_, i) => newCustomer(i)))
    const sold = await race(30, (i) => claim(offer, customers[i]!, 1, 2))
    assert.equal(sold, 5)
    const o = (await t.db.query(`SELECT qty_available FROM flash_offers WHERE id = $1`, [offer])).rows[0]
    assert.equal(o.qty_available, 0)
    await t.db.query(`UPDATE flash_offers SET status = 'SOLD_OUT' WHERE id = $1`, [offer])
  })

  it('limite por cliente vale mesmo com 6 tentativas simultâneas do mesmo cliente', async () => {
    const { rows } = await t.db.query(
      `INSERT INTO flash_offers (merchant_id, product_id, original_price, offer_price, qty_total, qty_available, max_per_customer, ends_at)
       VALUES ($1, $2, 4.29, 2.00, 10, 10, 2, now() + interval '1 hour') RETURNING id`,
      [ZE, CREME],
    )
    const offer = rows[0].id as string
    const sold = await race(6, () => claim(offer, MARIA, 1, 2))
    assert.equal(sold, 2)
    // O ROLLBACK devolveu o saldo das tentativas recusadas: só 2 unidades saíram da oferta.
    assert.equal((await t.db.query(`SELECT qty_available FROM flash_offers WHERE id = $1`, [offer])).rows[0].qty_available, 8)
    await t.db.query(`UPDATE flash_offers SET status = 'CANCELLED' WHERE id = $1`, [offer])
  })

  it('o banco recusa oferta com produto de outro lojista e duas ofertas vivas no mesmo produto', async () => {
    await assert.rejects(
      t.db.query(
        `INSERT INTO flash_offers (merchant_id, product_id, original_price, offer_price, qty_total, qty_available, ends_at)
         VALUES ($1, $2, 4.29, 2.00, 1, 1, now() + interval '1 hour')`,
        [LUCIA, CREME],
      ),
      /flash_offers_owner/,
    )
    await t.db.query(
      `INSERT INTO flash_offers (merchant_id, product_id, original_price, offer_price, qty_total, qty_available, ends_at)
       VALUES ($1, $2, 4.29, 2.00, 1, 1, now() + interval '1 hour')`,
      [ZE, CREME],
    )
    await assert.rejects(
      t.db.query(
        `INSERT INTO flash_offers (merchant_id, product_id, original_price, offer_price, qty_total, qty_available, ends_at)
         VALUES ($1, $2, 4.29, 2.50, 1, 1, now() + interval '1 hour')`,
        [ZE, CREME],
      ),
      /uq_flash_offers_one_live/,
    )
  })

  it('o Radar lista a oferta viva e o raio usa distance_m', async () => {
    const { rows } = await t.db.query(`SELECT offer_price::float8 AS price, discount_pct, store_lat, store_lng FROM v_flash_offers_live WHERE merchant_id = $1`, [ZE])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].price, 2)
    assert.equal(rows[0].discount_pct, 53)
    // Esquina a ~300 m da loja do Zé (seed: -3.7371, -38.4960) → dentro do Flash de 800 m; Praia de Iracema (~5 km) → fora.
    const near = await t.db.query(`SELECT distance_m($1, $2, -3.7398, -38.4960) AS d`, [rows[0].store_lat, rows[0].store_lng])
    const far = await t.db.query(`SELECT distance_m($1, $2, -3.7226, -38.5119) AS d`, [rows[0].store_lat, rows[0].store_lng])
    assert.ok(near.rows[0].d > 200 && near.rows[0].d < 400, `perto: ${near.rows[0].d}`)
    assert.ok(far.rows[0].d > 2000, `longe: ${far.rows[0].d}`)
  })
})

describe('caderneta (fiado)', () => {
  it('20 compras simultâneas de R$ 10 contra limite de R$ 100: passam 10 e o saldo bate com o livro', async () => {
    const customer = await newCustomer(900)
    const { rows } = await t.db.query(
      `INSERT INTO credit_accounts (merchant_id, customer_id, credit_limit) VALUES ($1, $2, 100) RETURNING id`,
      [ZE, customer],
    )
    const account = rows[0].id as string
    const ok = await race(20, async () => {
      try {
        await withTransaction(t.db, async (c) => {
          const r = await c.query(
            `UPDATE credit_accounts SET balance = balance + 10
              WHERE id = $1 AND status = 'ACTIVE' AND balance + 10 <= credit_limit RETURNING balance`,
            [account],
          )
          if (r.rowCount === 0) throw new Error('LIMITE')
          await c.query(`INSERT INTO credit_ledger (account_id, kind, amount, balance_after) VALUES ($1, 'CHARGE', 10, $2)`, [account, r.rows[0].balance])
        })
        return true
      } catch {
        return false
      }
    })
    assert.equal(ok, 10)
    const acc = (await t.db.query(`SELECT balance::float8 AS balance FROM credit_accounts WHERE id = $1`, [account])).rows[0]
    const sum = (await t.db.query(`SELECT sum(amount)::float8 AS s FROM credit_ledger WHERE account_id = $1`, [account])).rows[0]
    assert.equal(acc.balance, 100)
    assert.equal(sum.s, acc.balance)
  })

  it('saldo bate com o livro depois de cobranças, pagamento e ajuste em sequência', async () => {
    const customer = await newCustomer(910)
    const account = (await t.db.query(`INSERT INTO credit_accounts (merchant_id, customer_id, credit_limit) VALUES ($1, $2, 100) RETURNING id`, [ZE, customer])).rows[0].id as string
    const lanca = (kind: string, amount: number) =>
      withTransaction(t.db, async (c) => {
        const r = await c.query(`UPDATE credit_accounts SET balance = balance + $2 WHERE id = $1 RETURNING balance`, [account, amount])
        await c.query(`INSERT INTO credit_ledger (account_id, kind, amount, balance_after) VALUES ($1, $2, $3, $4)`, [account, kind, amount, r.rows[0].balance])
      })
    await lanca('CHARGE', 50)
    await lanca('CHARGE', 30)
    await lanca('PAYMENT', -20)
    await lanca('ADJUSTMENT', -5)
    await lanca('CHARGE', 15)
    const acc = (await t.db.query(`SELECT balance::float8 AS balance FROM credit_accounts WHERE id = $1`, [account])).rows[0]
    const sum = (await t.db.query(`SELECT sum(amount)::float8 AS s FROM credit_ledger WHERE account_id = $1`, [account])).rows[0]
    assert.equal(acc.balance, 70)
    assert.equal(sum.s, 70)
  })

  it('o livro recusa pagamento com sinal errado', async () => {
    const { rows } = await t.db.query(`SELECT id FROM credit_accounts LIMIT 1`)
    await assert.rejects(t.db.query(`INSERT INTO credit_ledger (account_id, kind, amount, balance_after) VALUES ($1, 'PAYMENT', 10, 0)`, [rows[0].id]), /credit_ledger_sign/)
  })
})

describe('entregas', () => {
  async function newDelivery() {
    const { rows: o } = await t.db.query(
      `INSERT INTO orders (customer_id, merchant_id, total_price, fulfillment) VALUES ($1, $2, 10, 'FLASH') RETURNING id`,
      [MARIA, ZE],
    )
    const { rows } = await t.db.query(
      `INSERT INTO deliveries (order_id, merchant_id, pin_code, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
       VALUES ($1, $2, '4821', -3.7371, -38.496, -3.7398, -38.496) RETURNING id`,
      [o[0].id, ZE],
    )
    return rows[0].id as string
  }

  it('8 entregadores aceitam o mesmo chamado: só um leva', async () => {
    const delivery = await newDelivery()
    const couriers = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const id = await newCustomer(800 + i)
        await t.db.query(`INSERT INTO couriers (user_id, vehicle, neighborhood, city, approved, status) VALUES ($1, 'MOTO', 'Aldeota', 'Fortaleza', TRUE, 'AVAILABLE')`, [id])
        return id
      }),
    )
    const won = await race(8, async (i) => {
      const r = await t.db.query(
        `UPDATE deliveries SET courier_id = $2, status = 'ACCEPTED', accepted_at = now()
          WHERE id = $1 AND courier_id IS NULL AND status IN ('REQUESTED', 'OFFERED')`,
        [delivery, couriers[i]],
      )
      return r.rowCount === 1
    })
    assert.equal(won, 1)
  })

  it('PIN: errar 5 vezes trava a entrega; PIN certo depois do bloqueio não fecha', async () => {
    const delivery = await newDelivery()
    const courier = (await t.db.query(`SELECT user_id FROM couriers LIMIT 1`)).rows[0].user_id
    await t.db.query(`UPDATE deliveries SET courier_id = $2, status = 'PICKED_UP' WHERE id = $1`, [delivery, courier])
    const confirm = async (pin: string) => {
      const r = await t.db.query(
        `UPDATE deliveries SET status = 'DELIVERED', delivered_at = now()
          WHERE id = $1 AND status = 'PICKED_UP' AND pin_attempts < 5 AND pin_code = $2`,
        [delivery, pin],
      )
      if (r.rowCount === 0) await t.db.query(`UPDATE deliveries SET pin_attempts = LEAST(pin_attempts + 1, 5) WHERE id = $1 AND status = 'PICKED_UP'`, [delivery])
      return r.rowCount === 1
    }
    for (const bad of ['0000', '1111', '2222', '3333', '4444']) assert.equal(await confirm(bad), false)
    assert.equal(await confirm('4821'), false)
    assert.equal((await t.db.query(`SELECT status FROM deliveries WHERE id = $1`, [delivery])).rows[0].status, 'PICKED_UP')
  })

  it('PIN: pin_attempts fica entre 0 e 5 (o CHECK recusa 6 e -1; tentativas além do limite saturam em 5)', async () => {
    const delivery = await newDelivery()
    await assert.rejects(t.db.query(`UPDATE deliveries SET pin_attempts = 6 WHERE id = $1`, [delivery]), /pin_attempts/)
    await assert.rejects(t.db.query(`UPDATE deliveries SET pin_attempts = -1 WHERE id = $1`, [delivery]), /pin_attempts/)
    for (let i = 0; i < 8; i++) await t.db.query(`UPDATE deliveries SET pin_attempts = LEAST(pin_attempts + 1, 5) WHERE id = $1`, [delivery])
    assert.equal((await t.db.query(`SELECT pin_attempts FROM deliveries WHERE id = $1`, [delivery])).rows[0].pin_attempts, 5)
  })

  it('o banco recusa entrega em andamento sem entregador e PIN que não tem 4 dígitos', async () => {
    const delivery = await newDelivery()
    await assert.rejects(t.db.query(`UPDATE deliveries SET status = 'ACCEPTED' WHERE id = $1`, [delivery]), /deliveries_courier_when_moving/)
    await assert.rejects(t.db.query(`UPDATE deliveries SET pin_code = '12a4' WHERE id = $1`, [delivery]), /pin_code/)
  })
})

describe('encomendas e prato do dia', () => {
  it('faixa com capacidade 3 e 10 reservas simultâneas: 3 entram', async () => {
    const { rows } = await t.db.query(
      `INSERT INTO pickup_slots (merchant_id, weekday, starts_at, ends_at, capacity) VALUES ($1, 6, '15:00', '17:00', 3) RETURNING id`,
      [ZE],
    )
    const slot = rows[0].id as string
    const ok = await race(10, async () => {
      const r = await t.db.query(
        `INSERT INTO slot_bookings (slot_id, slot_date, booked) VALUES ($1, current_date + 1, 1)
         ON CONFLICT (slot_id, slot_date) DO UPDATE SET booked = slot_bookings.booked + 1
           WHERE slot_bookings.booked < (SELECT capacity FROM pickup_slots WHERE id = $1)
         RETURNING booked`,
        [slot],
      )
      return r.rowCount === 1
    })
    assert.equal(ok, 3)
  })

  it('reservas em sequência: faixa de capacidade 2 e 4 pedidos seguidos, entram só 2', async () => {
    const { rows } = await t.db.query(
      `INSERT INTO pickup_slots (merchant_id, weekday, starts_at, ends_at, capacity) VALUES ($1, 5, '09:00', '11:00', 2) RETURNING id`,
      [ZE],
    )
    const slot = rows[0].id as string
    const entrou: boolean[] = []
    for (let i = 0; i < 4; i++) {
      const r = await t.db.query(
        `INSERT INTO slot_bookings (slot_id, slot_date, booked) VALUES ($1, current_date + 2, 1)
         ON CONFLICT (slot_id, slot_date) DO UPDATE SET booked = slot_bookings.booked + 1
           WHERE slot_bookings.booked < (SELECT capacity FROM pickup_slots WHERE id = $1)
         RETURNING booked`,
        [slot],
      )
      entrou.push(r.rowCount === 1)
    }
    assert.deepEqual(entrou, [true, true, false, false])
    assert.equal((await t.db.query(`SELECT booked FROM slot_bookings WHERE slot_id = $1 AND slot_date = current_date + 2`, [slot])).rows[0].booked, 2)
  })

  it('prato do dia com 4 porções e 10 pedidos simultâneos: vendem 4; desligado não vende', async () => {
    const { rows } = await t.db.query(
      `INSERT INTO daily_menu (merchant_id, product_id, qty_total, qty_available) VALUES ($1, $2, 4, 4) RETURNING id`,
      [ZE, CREME],
    )
    const id = rows[0].id as string
    const sell = async () =>
      (await t.db.query(
        `UPDATE daily_menu SET qty_available = qty_available - 1, updated_at = now()
          WHERE id = $1 AND menu_date = current_date AND is_on AND qty_available >= 1`,
        [id],
      )).rowCount === 1
    assert.equal(await race(10, sell), 4)
    await t.db.query(`UPDATE daily_menu SET qty_available = 2, is_on = FALSE WHERE id = $1`, [id])
    assert.equal(await sell(), false)
  })
})

describe('clube VIP', () => {
  it('desconto progressivo pela antiguidade: 1º mês 2%, 7 meses 6%, sem assinatura 0', async () => {
    const plan = (await t.db.query(`SELECT id FROM vip_plans WHERE code = 'vizinho-vip'`)).rows[0].id
    const seen = await newCustomer(700)
    await t.db.query(`INSERT INTO vip_subscriptions (user_id, plan_id, current_period_end) VALUES ($1, $2, now() + interval '20 days')`, [seen, plan])
    assert.equal(Number((await t.db.query(`SELECT vip_discount_pct($1) AS d`, [seen])).rows[0].d), 2)

    const veteran = await newCustomer(701)
    await t.db.query(
      `INSERT INTO vip_subscriptions (user_id, plan_id, started_at, current_period_end) VALUES ($1, $2, now() - interval '7 months', now() + interval '20 days')`,
      [veteran, plan],
    )
    assert.equal(Number((await t.db.query(`SELECT vip_discount_pct($1) AS d`, [veteran])).rows[0].d), 6)
    assert.equal(Number((await t.db.query(`SELECT vip_discount_pct($1) AS d`, [MARIA])).rows[0].d), 0)
  })

  it('percentual de faixa fora de 0 a 30 é recusado pelo banco', async () => {
    const plan = (await t.db.query(`SELECT id FROM vip_plans WHERE code = 'vizinho-vip'`)).rows[0].id
    await assert.rejects(t.db.query(`INSERT INTO vip_tiers (plan_id, min_months, discount_pct) VALUES ($1, 24, 31)`, [plan]), /discount_pct/)
    await assert.rejects(t.db.query(`INSERT INTO vip_tiers (plan_id, min_months, discount_pct) VALUES ($1, 24, -1)`, [plan]), /discount_pct/)
    // O limite superior (30) é aceito; a linha de teste sai logo depois para não afetar os outros casos.
    await t.db.query(`INSERT INTO vip_tiers (plan_id, min_months, discount_pct) VALUES ($1, 24, 30)`, [plan])
    await t.db.query(`DELETE FROM vip_tiers WHERE plan_id = $1 AND min_months = 24`, [plan])
  })

  it('no máximo uma assinatura vigente por usuário', async () => {
    const plan = (await t.db.query(`SELECT id FROM vip_plans WHERE code = 'vizinho-vip'`)).rows[0].id
    const { rows } = await t.db.query(`SELECT user_id FROM vip_subscriptions LIMIT 1`)
    await assert.rejects(
      t.db.query(`INSERT INTO vip_subscriptions (user_id, plan_id, current_period_end) VALUES ($1, $2, now() + interval '1 day')`, [rows[0].user_id, plan]),
      /uq_vip_one_active/,
    )
  })
})
