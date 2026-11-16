import type { ScheduleOrderInput } from '@vizinhohub/contracts/scheduling'
import { type DbClient, toCents } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

// Agendamento do pedido (encomendas). Roda DENTRO da transação do pedido: se algo falha, tudo volta.
const TZ = `'America/Fortaleza'`

/**
 * Valida a antecedência e a faixa, reserva a vaga e grava scheduled_for/slot_id/deposit_amount no pedido.
 * Reserva atômica (sem SELECT prévio da lotação):
 *   INSERT INTO slot_bookings ... ON CONFLICT (slot_id, slot_date) DO UPDATE SET booked = booked + 1
 *   WHERE booked < capacity RETURNING booked      → 0 linhas = faixa lotada (409 SLOT_FULL)
 * Devolve o sinal gravado (0 se não há agendamento).
 */
export async function applySchedule(
  tx: DbClient,
  args: { orderId: string; merchantId: string; total: string; productIds: string[]; schedule?: ScheduleOrderInput },
): Promise<{ deposit: number }> {
  const { rows: lead } = await tx.query<{ hours: number }>(
    `SELECT COALESCE(max(lead_time_hours), 0)::int AS hours FROM products WHERE id = ANY($1::uuid[])`,
    [args.productIds],
  )
  const leadHours = lead[0]!.hours
  const schedule = args.schedule
  if (!schedule) {
    if (leadHours > 0) {
      throw new AppError(422, 'SCHEDULE_REQUIRED', `Há itens sob encomenda no carrinho: escolha o dia e a faixa de retirada (antecedência de ${leadHours} h).`, { leadTimeHours: leadHours })
    }
    return { deposit: 0 }
  }

  const when = new Date(schedule.scheduledFor)
  const earliest = new Date(Date.now() + leadHours * 3_600_000)
  if (when.getTime() <= Date.now()) throw new AppError(422, 'SCHEDULE_IN_PAST', 'Escolha uma data e hora no futuro.')
  if (when.getTime() < earliest.getTime()) {
    throw new AppError(422, 'LEAD_TIME', `Este pedido precisa de ${leadHours} h de antecedência.`, { leadTimeHours: leadHours, earliest: earliest.toISOString() })
  }
  if (toCents(schedule.depositAmount) > toCents(args.total)) throw new AppError(422, 'DEPOSIT_TOO_HIGH', 'O sinal não pode ser maior que o total do pedido.')

  let slotId: string | null = null
  if (schedule.slotId) {
    // Dia da semana, data e hora no fuso da loja (Fortaleza); a faixa tem que ser da loja, estar ativa e conter o horário.
    const { rows } = await tx.query<{ ok: boolean; day: string }>(
      `SELECT (s.active AND s.weekday = EXTRACT(dow FROM w)::int AND w::time >= s.starts_at AND w::time < s.ends_at) AS ok,
              w::date::text AS day
         FROM pickup_slots s, (SELECT $3::timestamptz AT TIME ZONE ${TZ} AS w) t
        WHERE s.id = $1 AND s.merchant_id = $2`,
      [schedule.slotId, args.merchantId, schedule.scheduledFor],
    )
    if (!rows[0]) throw new AppError(422, 'SLOT_INVALID', 'Faixa de retirada inválida para esta loja.')
    if (!rows[0].ok) throw new AppError(422, 'SLOT_MISMATCH', 'O horário escolhido não está dentro da faixa de retirada.')
    const booked = await tx.query(
      `INSERT INTO slot_bookings (slot_id, slot_date, booked) VALUES ($1, $2::date, 1)
       ON CONFLICT (slot_id, slot_date) DO UPDATE SET booked = slot_bookings.booked + 1
         WHERE slot_bookings.booked < (SELECT capacity FROM pickup_slots WHERE id = $1)
       RETURNING booked`,
      [schedule.slotId, rows[0].day],
    )
    if (booked.rowCount === 0) throw new AppError(409, 'SLOT_FULL', 'Esta faixa de retirada está lotada neste dia. Escolha outra.')
    slotId = schedule.slotId
  } else {
    const { rows } = await tx.query(`SELECT 1 FROM pickup_slots WHERE merchant_id = $1 AND active LIMIT 1`, [args.merchantId])
    if (rows[0]) throw new AppError(422, 'SLOT_REQUIRED', 'Escolha uma faixa de retirada.')
  }

  await tx.query(`UPDATE orders SET scheduled_for = $2, slot_id = $3, deposit_amount = $4 WHERE id = $1`, [args.orderId, schedule.scheduledFor, slotId, schedule.depositAmount])
  return { deposit: schedule.depositAmount }
}

/** Cancelamento: devolve a vaga da faixa (a data da reserva é a do agendamento, no fuso da loja). */
export async function releaseSchedule(tx: DbClient, orderId: string): Promise<void> {
  await tx.query(
    `UPDATE slot_bookings b SET booked = b.booked - 1
       FROM orders o
      WHERE o.id = $1 AND o.slot_id = b.slot_id AND b.slot_date = (o.scheduled_for AT TIME ZONE ${TZ})::date AND b.booked > 0`,
    [orderId],
  )
}
