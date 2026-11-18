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

const NO_VIP = { pct: 0, freeDeliveryMinOrder: null }

/**
 * Benefício VIP do cliente logado na loja: percentual de desconto e pedido mínimo do frete grátis
 * (null = sem frete grátis aqui). Sem login ou com erro, sem benefício. O valor final vem do servidor.
 */
export function useVipDiscount(merchantId, enabled) {
  const [vip, setVip] = useState(NO_VIP)
  useEffect(() => {
    let alive = true
    setVip(NO_VIP)
    if (!merchantId || !enabled) return undefined
    const fetchDiscount = async () => {
      try {
        const r = await getVipDiscountAt(merchantId)
        if (alive) setVip({ pct: r.discountPct, freeDeliveryMinOrder: r.freeDeliveryMinOrder ?? null })
      } catch {}
    }
    fetchDiscount()
    return () => {
      alive = false
    }
  }, [merchantId, enabled])
  return vip
}
