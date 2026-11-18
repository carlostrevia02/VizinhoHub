import { api } from './api'

// Funil da vitrine (alimenta a Conversão do dashboard). Anônimo: a sessão é um UUID guardado neste navegador.
const KEY = 'vizinhohub:session'

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // Navegador antigo sem randomUUID: UUID v4 manual.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

let memoryId = null
export function sessionId() {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = newId()
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    memoryId ??= newId() // sem armazenamento: vale até recarregar
    return memoryId
  }
}

const sent = new Set()

/**
 * Registra um passo do funil: STORE_VIEW | PRODUCT_VIEW | ADD_TO_CART | CHECKOUT_START.
 * Nunca atrapalha a navegação: erro de rede é ignorado. `once` evita repetir o mesmo evento na sessão da página.
 */
export function track(type, merchantId, productId, { once = false } = {}) {
  if (!merchantId) return
  const key = `${type}:${merchantId}:${productId ?? ''}`
  if (once) {
    if (sent.has(key)) return
    sent.add(key)
  }
  const postEvent = async () => {
    try {
      await api.post('/events', { merchantId, sessionId: sessionId(), type, ...(productId && { productId }) })
    } catch {}
  }
  postEvent()
}
