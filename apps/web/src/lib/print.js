import { api } from './api'
import { formatBRL } from './format'
import { customerName, formatWhen, orderCode } from './useOrders'

// Impressão da comanda em papel térmico de 80 mm. Um site não fala ESC/POS sozinho: o caminho mais simples é
// window.print() com CSS de 80 mm. Para imprimir sem diálogo, abra o Chrome do caixa com --kiosk-printing.
const AUTO_KEY = 'vizinhohub:autoprint'

export function autoPrintEnabled() {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off'
  } catch {
    return true
  }
}
export function setAutoPrint(on) {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off')
  } catch {
    /* vale só até recarregar */
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function ticketHtml(order, copyNo = 1) {
  const items = order.items
    .map((i) => `<tr><td>${i.quantity}x</td><td>${esc(i.name)}</td><td class="r">${formatBRL(i.quantity * i.unitPrice)}</td></tr>`)
    .join('')
  const c = order.contact ?? {}
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido ${orderCode(order.id)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { width: 74mm; margin: 0; font: 12px/1.35 'Courier New', monospace; color: #000; }
  h1 { font-size: 16px; margin: 0 0 2px; text-align: center; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 1px 2px; }
  .tot { font-size: 15px; font-weight: bold; }
</style></head><body>
  <h1>PEDIDO #${orderCode(order.id)}</h1>
  <p class="c">${esc(formatWhen(order.createdAt))}${copyNo > 1 ? ` · ${copyNo}ª via` : ''}</p>
  <hr>
  <p><b>${esc(customerName(order))}</b>${c.phone ? `<br>${esc(c.phone)}` : ''}<br>${esc(c.deliveryMethod ?? 'Retirada')}${c.deliveryAddress ? `<br>${esc(c.deliveryAddress)}` : ''}</p>
  <hr>
  <table>${items}</table>
  <hr>
  <p class="tot r">TOTAL ${formatBRL(order.totalPrice)}</p>
  <p>Pagamento: ${esc(c.paymentMethod ?? 'não informado')}</p>
  ${c.notes ? `<p>Obs.: ${esc(c.notes)}</p>` : ''}
  <hr><p class="c">VizinhoHub</p>
</body></html>`
}

/** Imprime num iframe invisível (sem abrir aba). Resolve quando o diálogo/impressão foi disparado. */
export function printOrder(order, copyNo = 1) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    frame.onload = () => {
      try {
        frame.contentWindow.focus()
        frame.contentWindow.print()
        resolve()
      } catch (err) {
        reject(err)
      } finally {
        setTimeout(() => frame.remove(), 2000)
      }
    }
    frame.srcdoc = ticketHtml(order, copyNo)
    document.body.appendChild(frame)
  })
}

const printing = new Set()

/** Imprime um job da fila e confirma na API. Jobs já em andamento neste navegador são ignorados. */
export async function runPrintJob(job) {
  if (printing.has(job.id)) return
  printing.add(job.id)
  try {
    await printOrder(job.order, job.copyNo)
    await api.post(`/print-jobs/${job.id}/ack`, { ok: true })
  } catch (err) {
    await api.post(`/print-jobs/${job.id}/ack`, { ok: false, error: String(err?.message ?? err).slice(0, 200) }).catch(() => {})
  } finally {
    printing.delete(job.id)
  }
}
