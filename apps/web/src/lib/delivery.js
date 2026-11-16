import { api, qs } from './api'

// Logística: entrega no bairro, entregadores e rastreamento (API /delivery).

// ---- cliente ---------------------------------------------------------------------------------------
export const getStoreDelivery = (merchantId) => api.get(`/delivery/stores/${merchantId}`)
export const trackOrderDelivery = (orderId) => api.get(`/delivery/orders/${orderId}`)

// ---- lojista ---------------------------------------------------------------------------------------
export const getDeliveryConfig = () => api.get('/delivery/config')
export const saveDeliveryConfig = (body) => api.put('/delivery/config', body)
export const listDeliveryOrders = () => api.get('/delivery/orders')
export const listDeliveries = (status) => api.get(`/delivery/deliveries${qs({ status })}`)
export const callCourier = (orderId) => api.post('/delivery/deliveries', { orderId })
export const unlockDeliveryPin = (id) => api.post(`/delivery/deliveries/${id}/unlock-pin`)

// ---- entregador ------------------------------------------------------------------------------------
export const getCourier = () => api.get('/delivery/courier')
export const registerCourier = (body) => api.post('/delivery/courier', body)
export const setCourierStatus = (status) => api.put('/delivery/courier/status', { status })
export const listCourierOffers = () => api.get('/delivery/courier/offers')
export const getActiveDelivery = () => api.get('/delivery/courier/active')
export const acceptDelivery = (id) => api.post(`/delivery/courier/deliveries/${id}/accept`)
export const declineDelivery = (id) => api.post(`/delivery/courier/deliveries/${id}/decline`)
export const sendCourierLocation = (point) => api.put('/delivery/courier/location', point)
export const pickUpDelivery = (id) => api.post(`/delivery/courier/deliveries/${id}/pickup`)
export const confirmDelivery = (id, pin) => api.post(`/delivery/courier/deliveries/${id}/deliver`, { pin })
export const failDelivery = (id, reason) => api.post(`/delivery/courier/deliveries/${id}/fail`, { reason })

export const DELIVERY_STATUS = {
  REQUESTED: ['prep', 'Aguardando entregador'],
  OFFERED: ['prep', 'Chamando entregadores'],
  ACCEPTED: ['new', 'Entregador a caminho da loja'],
  PICKED_UP: ['new', 'Saiu para entrega'],
  DELIVERED: ['ok', 'Entregue'],
  FAILED: ['low', 'Não entregue'],
  CANCELLED: ['off', 'Cancelada'],
}
export const VEHICLE_LABEL = { MOTO: 'Moto', BIKE: 'Bicicleta', FOOT: 'A pé' }

/** Distância em metros entre dois pontos (haversine), só para exibir "a X m". */
export function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export const formatDistance = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`)
