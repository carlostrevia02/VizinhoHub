import { LOCATION_RETENTION_DAYS } from './delivery.schema.js'

// LGPD: apaga o rastro de GPS com mais de 30 dias. Roda ao subir e uma vez por dia; o timer não segura o processo.
export function startLocationCleanupJob(purge: (days: number) => Promise<number>, intervalMs = 24 * 60 * 60 * 1000) {
  const run = async () => {
    try {
      const removed = await purge(LOCATION_RETENTION_DAYS)
      if (removed > 0) console.log(`Logística: ${removed} ponto(s) de GPS com mais de ${LOCATION_RETENTION_DAYS} dias apagado(s).`)
    } catch (err) {
      console.error('Falha no job de limpeza do GPS dos entregadores', err)
    }
  }
  void run()
  const timer = setInterval(run, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
