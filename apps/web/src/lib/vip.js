import { useEffect, useState } from 'react'
import { api } from './api'

// Clube VIP (Selo Vizinho VIP): chamadas à API.
export const listVipPlans = () => api.get('/vip/plans')
export const getVipMe = () => api.get('/vip/me')
export const listVipInvoices = () => api.get('/vip/invoices')
export const subscribeVip = (body) => api.post('/vip/subscribe', body)
export const cancelVip = (atPeriodEnd) => api.post('/vip/cancel', { atPeriodEnd })
export const simulateVipPayment = (invoiceId) => api.post(`/vip/dev/invoices/${invoiceId}/pay`)
export const getVipDiscountAt = (merchantId) => api.get(`/vip/discount/${merchantId}`)
export const getVipMerchant = () => api.get('/vip/merchant')
export const joinVipMerchant = (body) => api.post('/vip/merchant', body)
export const updateVipMerchant = (body) => api.put('/vip/merchant', body)
export const leaveVipMerchant = () => api.delete('/vip/merchant')

export const SUBSCRIPTION_LABEL = {
  ACTIVE: ['ok', 'Ativa'],
  PAST_DUE: ['prep', 'Pagamento pendente'],
  CANCELLED: ['off', 'Cancelada'],
  EXPIRED: ['off', 'Expirada'],
}
export const INVOICE_LABEL = {
  PENDING: ['prep', 'Aguardando'],
  PAID: ['ok', 'Paga'],
  FAILED: ['off', 'Falhou'],
  VOID: ['off', 'Anulada'],
}

/** "2026-02-10" → "10/02/2026" */
export const formatDay = (ymd) => ymd.split('-').reverse().join('/')
export const formatDate = (iso) => new Date(iso).toLocaleDateString('pt-BR')

/** Percentual de desconto VIP do cliente logado na loja (0 se não houver). Sem login ou com erro, 0. */
export function useVipDiscount(merchantId, enabled) {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    let alive = true
    setPct(0)
    if (!merchantId || !enabled) return undefined
    getVipDiscountAt(merchantId)
      .then((r) => alive && setPct(r.discountPct))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [merchantId, enabled])
  return pct
}
