import type { RenewalResult } from './vip.service.js'

// Clube VIP: renova/expira assinaturas (ver VipService.runRenewals). Roda ao subir e de hora em hora;
// o timer não segura o processo aberto e uma rodada em andamento não é duplicada.
export function startVipRenewalJob(run: () => Promise<RenewalResult>, intervalMs = 60 * 60 * 1000) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const r = await run()
      if (r.renewalInvoices + r.cancelled + r.expired > 0) {
        console.log(`Clube VIP: ${r.renewalInvoices} fatura(s) de renovação, ${r.cancelled} cancelada(s), ${r.expired} expirada(s).`)
      }
    } catch (err) {
      console.error('Falha no job de renovação do Clube VIP', err)
    } finally {
      running = false
    }
  }
  void tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
