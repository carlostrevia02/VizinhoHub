import type { Db } from './db.js'

// Salva-Estoque: liga/desliga is_clearance conforme a validade (função do banco).
// Roda ao subir e de hora em hora; o timer não segura o processo aberto.
export function startClearanceJob(db: Db, intervalMs = 60 * 60 * 1000) {
  const run = async () => {
    try {
      const { rows } = await db.query<{ changed: number }>('SELECT refresh_clearance() AS changed')
      if (rows[0]!.changed > 0) console.log(`Salva-Estoque: ${rows[0]!.changed} produto(s) atualizado(s).`)
    } catch (err) {
      console.error('Falha no job do Salva-Estoque', err)
    }
  }
  void run()
  const timer = setInterval(run, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

// Ofertas do Bairro: lê os supermercados cadastrados e atualiza as ofertas. Roda ao subir e a cada
// `intervalMs`; se uma varredura ainda estiver em andamento, a próxima rodada é pulada.
export function startDealsScanJob(scan: () => Promise<{ skipped: boolean; ok: number; unchanged: number; empty: number; failed: number; deals: number }>, intervalMs: number) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const s = await scan()
      if (!s.skipped) console.log(`Ofertas do Bairro: ${s.deals} oferta(s) · ${s.ok} fonte(s) lida(s), ${s.unchanged} sem mudança, ${s.empty} vazia(s), ${s.failed} com erro.`)
    } catch (err) {
      console.error('Falha no job de Ofertas do Bairro', err)
    } finally {
      running = false
    }
  }
  void run()
  const timer = setInterval(run, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

// Tá Quentinho: encerra as ofertas relâmpago que passaram do prazo. Roda ao subir e a cada minuto.
export function startFlashExpiryJob(expireStale: () => Promise<number>, intervalMs = 60 * 1000) {
  const run = async () => {
    try {
      const closed = await expireStale()
      if (closed > 0) console.log(`Tá Quentinho: ${closed} oferta(s) relâmpago encerrada(s).`)
    } catch (err) {
      console.error('Falha no job de expiração das ofertas relâmpago', err)
    }
  }
  void run()
  const timer = setInterval(run, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
