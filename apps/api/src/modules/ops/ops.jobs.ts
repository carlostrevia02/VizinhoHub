import type { Db } from '../../shared/db.js'

// Retenção do funil (store_events): 90 dias. Só telemetria de navegação; pedidos não dependem dela.
export const STORE_EVENTS_RETENTION_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

/** Apaga eventos do funil com mais de `days` dias. Devolve quantas linhas saíram. */
export async function purgeStoreEvents(db: Db, days = STORE_EVENTS_RETENTION_DAYS): Promise<number> {
  // Pseudonimização: linhas gravadas antes da decisão de 16/11/2026 ainda podem ter user_id.
  await db.query(`UPDATE store_events SET user_id = NULL WHERE user_id IS NOT NULL`)
  const { rowCount } = await db.query(`DELETE FROM store_events WHERE created_at < now() - make_interval(days => $1)`, [days])
  return rowCount ?? 0
}

// Roda ao subir e depois a cada 24 h; o timer não segura o processo aberto.
export function startStoreEventsRetentionJob(db: Db, intervalMs = DAY_MS) {
  const run = async () => {
    try {
      const removed = await purgeStoreEvents(db)
      if (removed > 0) console.log(`Funil: ${removed} evento(s) com mais de ${STORE_EVENTS_RETENTION_DAYS} dias apagado(s).`)
    } catch (err) {
      console.error('Falha no job de retenção do funil', err)
    }
  }
  void run()
  const timer = setInterval(run, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
