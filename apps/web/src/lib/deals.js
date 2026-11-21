// Ofertas do Bairro (apps/api, módulo deals). Usa a sessão da API que o site já mantém (lib/api.js).
import { api, qs } from './api'

// Com { lat, lng } (só quando o cliente escolheu/permitiu a localização) cada oferta traz `nearestBranch`.
export const listDeals = (params = {}) => api.get(`/deals${qs(params)}`)
export { branchLine, formatDistance, formatDuration } from './branchFormat'
export const listChains = () => api.get('/deals/chains')

export const claimCoupon = (dealId) => api.post(`/deals/${dealId}/coupon`)
export const listMyCoupons = () => api.get('/coupons/mine')
// O cliente confirma que pagou no caixa: o cupom vira REDEEMED (404 COUPON_NOT_FOUND, 409 COUPON_ALREADY_CONFIRMED | COUPON_EXPIRED).
export const confirmCoupon = (couponId) => api.post(`/coupons/${couponId}/confirm`)

// Encartes (imagem/PDF) enviados por gerente de rede. A leitura roda em segundo plano: o envio volta como PROCESSING.
export const FLYER_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
export const FLYER_LIMITS = { pdf: 20 * 1024 * 1024, image: 5 * 1024 * 1024 }

export const listFlyers = () => api.get('/deals/flyers')
export const uploadFlyer = ({ chain, neighborhood, validDays, append, file }) =>
  api.upload(`/deals/flyers${qs({ chain, neighborhood, validDays, append: append ? 'true' : undefined, fileName: file.name })}`, file)
