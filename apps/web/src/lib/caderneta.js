import { api, qs } from './api'

// Caderneta (fiado), encomendas/agenda, prato do dia e combos: chamadas à API (módulos credit, scheduling, daily-menu).
// A plataforma não intermedia pagamento: a baixa é manual e o lembrete leva o Pix da chave do próprio lojista.

// ---- Caderneta ----
export const listCreditAccounts = (params = {}) => api.get(`/credit/accounts${qs(params)}`)
export const listCreditCandidates = (params = {}) => api.get(`/credit/candidates${qs(params)}`)
export const openCreditAccount = (body) => api.post('/credit/accounts', body)
export const updateCreditAccount = (id, body) => api.patch(`/credit/accounts/${id}`, body)
export const getCreditLedger = (id) => api.get(`/credit/accounts/${id}/ledger`)
export const registerCreditPayment = (id, body) => api.post(`/credit/accounts/${id}/payments`, body)
export const registerCreditAdjustment = (id, body) => api.post(`/credit/accounts/${id}/adjustments`, body)
export const getCreditReminder = (id) => api.post(`/credit/accounts/${id}/reminder`)
export const listMyCredit = () => api.get('/credit/mine')

export const LEDGER_LABEL = { CHARGE: 'Compra', PAYMENT: 'Pagamento', ADJUSTMENT: 'Ajuste' }

// ---- Encomendas e agenda ----
export const listSlots = () => api.get('/scheduling/slots')
export const createSlot = (body) => api.post('/scheduling/slots', body)
export const updateSlot = (id, body) => api.patch(`/scheduling/slots/${id}`, body)
export const removeSlot = (id) => api.delete(`/scheduling/slots/${id}`)
export const listScheduledOrders = (from, to) => api.get(`/scheduling/orders${qs({ from, to })}`)
export const setLeadTime = (productId, leadTimeHours) => api.patch(`/scheduling/products/${productId}/lead-time`, { leadTimeHours })
export const getAvailability = (merchantId, from, days = 14) => api.get(`/scheduling/availability${qs({ merchantId, from, days })}`)

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

// "YYYY-MM-DD" de hoje + n dias (no relógio local do navegador).
export function isoDay(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const formatDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
export const formatDateTime = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// ---- Prato do dia e combos ----
export const getDailyMenu = (merchantId) => api.get(`/daily-menu${qs({ merchantId })}`)
export const listMyDailyMenu = () => api.get('/daily-menu/mine')
export const setDailyMenu = (body) => api.put('/daily-menu', body)
export const updateDailyMenu = (id, body) => api.patch(`/daily-menu/${id}`, body)
export const listCombos = (merchantId) => api.get(`/combos${qs({ merchantId })}`)
export const listMyCombos = () => api.get('/combos/mine')
export const createCombo = (body) => api.post('/combos', body)
export const removeCombo = (id) => api.delete(`/combos/${id}`)

// ---- Chave Pix (configurações da loja) ----
export const getStoreSettings = () => api.get('/stores/me/settings')
export const saveStoreSettings = (body) => api.put('/stores/me/settings', body)

/** Copia para a área de transferência; devolve true/false (sem permissão ou sem HTTPS, cai no plano B). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
