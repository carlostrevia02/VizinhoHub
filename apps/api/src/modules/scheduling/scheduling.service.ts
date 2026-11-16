import type { CreatePickupSlotInput, PickupSlotDTO, SlotAvailabilityDTO } from '@vizinhohub/contracts/scheduling'
import type { AuthUser } from '../../shared/auth.js'
import type { Db } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import { findOrderById } from '../orders/orders.repository.js'
import type { OrderDTO } from '../orders/orders.types.js'

const SLOT_COLS = `s.id, s.merchant_id AS "merchantId", s.weekday, to_char(s.starts_at, 'HH24:MI') AS "startsAt",
                   to_char(s.ends_at, 'HH24:MI') AS "endsAt", s.capacity, s.active`

const slotNotFound = () => new AppError(404, 'SLOT_NOT_FOUND', 'Faixa de retirada não encontrada.')

export function createSchedulingService(deps: { db: Db }) {
  const { db } = deps

  async function listSlots(merchant: AuthUser): Promise<PickupSlotDTO[]> {
    const { rows } = await db.query<PickupSlotDTO>(`SELECT ${SLOT_COLS} FROM pickup_slots s WHERE s.merchant_id = $1 ORDER BY s.weekday, s.starts_at`, [merchant.id])
    return rows
  }

  async function createSlot(merchant: AuthUser, input: CreatePickupSlotInput): Promise<PickupSlotDTO> {
    try {
      const { rows } = await db.query<PickupSlotDTO>(
        `WITH s AS (INSERT INTO pickup_slots (merchant_id, weekday, starts_at, ends_at, capacity, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *)
         SELECT ${SLOT_COLS} FROM s`,
        [merchant.id, input.weekday, input.startsAt, input.endsAt, input.capacity, input.active],
      )
      return rows[0]!
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new AppError(409, 'SLOT_EXISTS', 'Já existe uma faixa que começa neste horário neste dia da semana.')
      throw err
    }
  }

  async function updateSlot(merchant: AuthUser, id: string, patch: Partial<CreatePickupSlotInput>): Promise<PickupSlotDTO> {
    const cols = { weekday: 'weekday', startsAt: 'starts_at', endsAt: 'ends_at', capacity: 'capacity', active: 'active' } as const
    const sets: string[] = []
    const params: unknown[] = [id, merchant.id]
    for (const [key, col] of Object.entries(cols)) {
      const v = patch[key as keyof typeof cols]
      if (v === undefined) continue
      params.push(v)
      sets.push(`${col} = $${params.length}`)
    }
    try {
      const { rowCount } = await db.query(`UPDATE pickup_slots SET ${sets.join(', ')} WHERE id = $1 AND merchant_id = $2`, params)
      if (!rowCount) throw slotNotFound()
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === '23505') throw new AppError(409, 'SLOT_EXISTS', 'Já existe uma faixa que começa neste horário neste dia da semana.')
      if (code === '23514') throw new AppError(422, 'SLOT_INVALID', 'O fim precisa ser depois do início.')
      throw err
    }
    const { rows } = await db.query<PickupSlotDTO>(`SELECT ${SLOT_COLS} FROM pickup_slots s WHERE s.id = $1`, [id])
    return rows[0]!
  }

  // Faixa com pedidos vinculados não pode sumir (histórico): vira inativa. Sem pedidos, é apagada.
  async function removeSlot(merchant: AuthUser, id: string): Promise<'deleted' | 'deactivated'> {
    const { rows } = await db.query(`SELECT 1 FROM pickup_slots WHERE id = $1 AND merchant_id = $2`, [id, merchant.id])
    if (!rows[0]) throw slotNotFound()
    const used = await db.query(`SELECT 1 FROM orders WHERE slot_id = $1 LIMIT 1`, [id])
    if (used.rows[0]) {
      await db.query(`UPDATE pickup_slots SET active = FALSE WHERE id = $1`, [id])
      return 'deactivated'
    }
    await db.query(`DELETE FROM pickup_slots WHERE id = $1`, [id])
    return 'deleted'
  }

  // Vagas livres por faixa e dia (só faixas ativas que ainda não terminaram).
  async function availability(q: { merchantId: string; from: string; days: number }): Promise<SlotAvailabilityDTO[]> {
    const { rows } = await db.query<SlotAvailabilityDTO>(
      `SELECT s.id AS "slotId", d::date::text AS date, to_char(s.starts_at, 'HH24:MI') AS "startsAt", to_char(s.ends_at, 'HH24:MI') AS "endsAt",
              s.capacity, COALESCE(b.booked, 0)::int AS booked, GREATEST(s.capacity - COALESCE(b.booked, 0), 0)::int AS free
         FROM pickup_slots s
        CROSS JOIN generate_series($2::date, $2::date + ($3::int - 1), interval '1 day') d
         LEFT JOIN slot_bookings b ON b.slot_id = s.id AND b.slot_date = d::date
        WHERE s.merchant_id = $1 AND s.active AND EXTRACT(dow FROM d)::int = s.weekday
          AND (d::date + s.ends_at) > localtimestamp
        ORDER BY d, s.starts_at`,
      [q.merchantId, q.from, q.days],
    )
    return rows
  }

  // Agenda do lojista: pedidos agendados no intervalo (datas no fuso da loja), exceto cancelados.
  async function scheduledOrders(merchant: AuthUser, q: { from: string; to: string }): Promise<OrderDTO[]> {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM orders
        WHERE merchant_id = $1 AND scheduled_for IS NOT NULL AND status <> 'CANCELLED'
          AND (scheduled_for AT TIME ZONE 'America/Fortaleza')::date BETWEEN $2::date AND $3::date
        ORDER BY scheduled_for LIMIT 500`,
      [merchant.id, q.from, q.to],
    )
    const orders = await Promise.all(rows.map((r) => findOrderById(db, r.id)))
    return orders.filter((o): o is OrderDTO => !!o)
  }

  // Marca o produto como encomenda (antecedência mínima em horas; 0 = pronta entrega).
  async function setLeadTime(merchant: AuthUser, productId: string, leadTimeHours: number) {
    const { rows } = await db.query<{ id: string; leadTimeHours: number }>(
      `UPDATE products SET lead_time_hours = $3 WHERE id = $1 AND user_id = $2 AND active RETURNING id, lead_time_hours AS "leadTimeHours"`,
      [productId, merchant.id, leadTimeHours],
    )
    if (!rows[0]) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
    return rows[0]
  }

  return { listSlots, createSlot, updateSlot, removeSlot, availability, scheduledOrders, setLeadTime }
}

export type SchedulingService = ReturnType<typeof createSchedulingService>
