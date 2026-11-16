import type { ScheduleOrderInput } from '@vizinhohub/contracts/scheduling'
import { type DbClient, fromCents, toCents } from '../../shared/db.js'
import { chargeOrder, refundOrder } from '../credit/credit.ledger.js'
import { claimDailyMenu, releaseDailyMenu } from '../daily-menu/daily-menu.claims.js'
import { applySchedule, releaseSchedule } from '../scheduling/scheduling.booking.js'

// Pontos de extensão do pedido para Caderneta, Encomendas e Prato do Dia, agrupados aqui para que
// orders.service.ts só chame duas funções. Tudo roda na transação do pedido (falhou = ROLLBACK de tudo).

/** Depois de gravar o pedido e os itens: porções do dia, agenda/vaga e lançamento na caderneta (nesta ordem). */
export async function onOrderPlaced(
  tx: DbClient,
  ctx: {
    orderId: string
    merchantId: string
    customerId: string
    total: string
    paymentMethod?: string
    lines: { productId: string; quantity: number }[]
    schedule?: ScheduleOrderInput
  },
): Promise<void> {
  await claimDailyMenu(tx, ctx.lines)
  const { deposit } = await applySchedule(tx, { orderId: ctx.orderId, merchantId: ctx.merchantId, total: ctx.total, productIds: ctx.lines.map((l) => l.productId), schedule: ctx.schedule })
  if (ctx.paymentMethod === 'credit') {
    // O sinal (pago por fora) não vai para a caderneta: só o restante.
    const amount = fromCents(toCents(ctx.total) - toCents(deposit)).toFixed(2)
    await chargeOrder(tx, { orderId: ctx.orderId, merchantId: ctx.merchantId, customerId: ctx.customerId, amount })
  }
}

/** Cancelamento: devolve porções do dia, vaga da faixa e estorna o fiado. Sem nada a devolver, não faz nada. */
export async function onOrderCancelled(tx: DbClient, orderId: string): Promise<void> {
  await releaseDailyMenu(tx, orderId)
  await releaseSchedule(tx, orderId)
  await refundOrder(tx, orderId)
}
