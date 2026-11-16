import * as webpushNs from 'web-push'
import type { Db, DbClient } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import * as ordersRepo from '../orders/orders.repository.js'
import type { FunnelEvent, PrintJobDTO, PrintKind, PushPayload } from './ops.types.js'

type Queryable = Db | DbClient
// web-push é CommonJS: conforme o carregador, as funções vêm em .default ou direto no namespace.
const webpush = ((webpushNs as unknown as { default?: typeof webpushNs }).default ?? webpushNs) as typeof webpushNs

export interface OpsDeps {
  db: Db
  /** Avisa o caixa (WebSocket) que há um job novo. */
  onPrintJob?: (merchantId: string, job: PrintJobDTO) => void
  vapid?: { publicKey: string; privateKey: string; subject: string }
}

const JOB_SQL = `
  SELECT j.id, j.order_id AS "orderId", j.merchant_id AS "merchantId", j.kind, j.copy_no AS "copyNo", j.status, j.attempts,
         to_char(j.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM print_jobs j`

export function createOpsService(deps: OpsDeps) {
  const { db } = deps
  const vapid = deps.vapid
  if (vapid) webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

  // ---- funil (Conversão no Dashboard) -------------------------------------------------------------

  async function trackEvent(e: { merchantId: string; sessionId: string; type: FunnelEvent; productId?: string; userId?: string | null }) {
    // Só registra para loja que existe; produto de outra loja é ignorado em silêncio (evento é telemetria, não regra).
    // LGPD (decisão de 16/11/2026): o funil é pseudonimizado. A conversão usa só session_id, então user_id
    // não é gravado (a coluna fica NULL; o job de retenção também limpa linhas antigas).
    await db.query(
      `INSERT INTO store_events (merchant_id, session_id, user_id, type, product_id)
       SELECT u.id, $2, $3, $4, p.id
         FROM users u
         LEFT JOIN products p ON p.id = $5::uuid AND p.user_id = u.id
        WHERE u.id = $1 AND u.role = 'MERCHANT'`,
      [e.merchantId, e.sessionId, null, e.type, e.productId ?? null],
    )
  }

  // ---- impressão ---------------------------------------------------------------------------------

  async function autoPrintEnabled(tx: Queryable, merchantId: string): Promise<boolean> {
    const { rows } = await tx.query<{ auto_print: boolean }>(`SELECT auto_print FROM store_delivery_config WHERE merchant_id = $1`, [merchantId])
    return rows[0]?.auto_print ?? true
  }

  /** Grava o job na MESMA transação do pedido (nunca existe pedido sem job, nem job sem pedido). Devolve o id ou null. */
  async function enqueuePrint(tx: DbClient, orderId: string, merchantId: string, kind: PrintKind = 'TICKET'): Promise<string | null> {
    if (!(await autoPrintEnabled(tx, merchantId))) return null
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO print_jobs (merchant_id, order_id, kind) VALUES ($1, $2, $3)
       ON CONFLICT (order_id, kind, copy_no) DO NOTHING RETURNING id`,
      [merchantId, orderId, kind],
    )
    return rows[0]?.id ?? null
  }

  async function loadJob(q: Queryable, id: string): Promise<(PrintJobDTO & { merchantId: string }) | undefined> {
    const { rows } = await q.query<Omit<PrintJobDTO, 'order'> & { merchantId: string }>(`${JOB_SQL} WHERE j.id = $1`, [id])
    const row = rows[0]
    if (!row) return undefined
    const order = await ordersRepo.findOrderById(q, row.orderId)
    return order ? { ...row, order } : undefined
  }

  /** Depois do COMMIT: empurra o job pelo WebSocket. Falha aqui não desfaz nada (o job espera em QUEUED). */
  async function announcePrint(jobId: string | null) {
    if (!jobId || !deps.onPrintJob) return
    try {
      const job = await loadJob(db, jobId)
      if (job) deps.onPrintJob(job.merchantId, job)
    } catch (err) {
      console.error('Falha ao avisar o caixa sobre o job de impressão', err)
    }
  }

  /** Fila do caixa ao (re)conectar: tudo que ainda não foi impresso. */
  async function listPendingPrint(merchantId: string): Promise<PrintJobDTO[]> {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM print_jobs WHERE merchant_id = $1 AND status IN ('QUEUED', 'SENT') ORDER BY created_at LIMIT 50`,
      [merchantId],
    )
    const jobs: PrintJobDTO[] = []
    for (const r of rows) {
      const job = await loadJob(db, r.id)
      if (job) jobs.push(job)
    }
    return jobs
  }

  async function ackPrint(merchantId: string, jobId: string, ack: { ok: boolean; error?: string }) {
    const { rowCount } = await db.query(
      `UPDATE print_jobs
          SET status = CASE WHEN $3 THEN 'PRINTED' ELSE 'FAILED' END,
              attempts = attempts + 1,
              last_error = CASE WHEN $3 THEN NULL ELSE $4 END,
              printed_at = CASE WHEN $3 THEN now() ELSE printed_at END
        WHERE id = $1 AND merchant_id = $2 AND status IN ('QUEUED', 'SENT', 'FAILED')`,
      [jobId, merchantId, ack.ok, ack.error ?? null],
    )
    if (rowCount === 0) throw new AppError(404, 'PRINT_JOB_NOT_FOUND', 'Impressão não encontrada ou já concluída.')
  }

  /** Reimpressão manual: copy_no + 1. */
  async function reprint(merchantId: string, orderId: string) {
    const order = await ordersRepo.findOrderById(db, orderId)
    if (!order || order.merchantId !== merchantId) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO print_jobs (merchant_id, order_id, kind, copy_no)
       SELECT $1, $2, 'TICKET', coalesce(max(copy_no), 0) + 1 FROM print_jobs WHERE order_id = $2 AND kind = 'TICKET'
       RETURNING id`,
      [merchantId, orderId],
    )
    await announcePrint(rows[0]!.id)
    return rows[0]!.id
  }

  // ---- Web Push (PWA) ---------------------------------------------------------------------------

  const publicKey = () => vapid?.publicKey ?? null

  async function subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, app: string, userAgent?: string) {
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, app, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, app = EXCLUDED.app`,
      [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, app, userAgent ?? null],
    )
  }

  async function unsubscribe(userId: string, endpoint: string) {
    await db.query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, endpoint])
  }

  /** Envia para todos os aparelhos dos usuários. Endpoint morto (404/410) é apagado. Nunca lança. */
  async function pushToUsers(userIds: string[], payload: PushPayload, app?: 'CUSTOMER' | 'MERCHANT' | 'COURIER'): Promise<number> {
    if (!vapid || userIds.length === 0) return 0
    const { rows } = await db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[]) AND ($2::text IS NULL OR app = $2)`,
      [userIds, app ?? null],
    )
    let sent = 0
    await Promise.all(
      rows.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 })
          sent++
          await db.query(`UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1`, [s.id])
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) await db.query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id])
          else console.error('Falha ao enviar push', status ?? err)
        }
      }),
    )
    return sent
  }

  return { trackEvent, enqueuePrint, announcePrint, listPendingPrint, ackPrint, reprint, publicKey, subscribe, unsubscribe, pushToUsers }
}

export type OpsService = ReturnType<typeof createOpsService>
