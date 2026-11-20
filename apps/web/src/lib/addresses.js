import { useCallback, useSyncExternalStore } from 'react'

// Endereços de entrega do cliente. Ainda não há endpoint na API: ficam no navegador, por usuário.
// Formato: { id, label, street, number, complement, neighborhood, city, state, zip, lat?, lng?, primary }
// Sem endereços de exemplo: quem não cadastrou nenhum vê "Escolha onde entregar" e as ofertas de todos os bairros.
const SEED = []

const storageKey = (userId) => `vizinhohub:addresses:${userId ?? 'guest'}`
const cache = new Map()
const listeners = new Set()

function read(userId) {
  if (!cache.has(userId)) {
    let list = null
    try {
      list = JSON.parse(localStorage.getItem(storageKey(userId)))
    } catch {
      /* armazenamento indisponível ou corrompido: volta ao padrão */
    }
    cache.set(userId, Array.isArray(list) && list.length ? list : SEED)
  }
  return cache.get(userId)
}

function write(userId, list) {
  // Garante exatamente um endereço principal.
  const primaryId = (list.find((a) => a.primary) ?? list[0])?.id
  const next = list.map((a) => ({ ...a, primary: a.id === primaryId }))
  cache.set(userId, next)
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next))
  } catch {
    /* sem armazenamento: vale até recarregar */
  }
  listeners.forEach((fn) => fn())
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useAddresses(userId) {
  const list = useSyncExternalStore(subscribe, () => read(userId))
  const save = useCallback(
    (addr) => {
      const cur = read(userId)
      const id = addr.id ?? `a${Date.now().toString(36)}`
      const item = { ...addr, id }
      const merged = cur.some((a) => a.id === id) ? cur.map((a) => (a.id === id ? item : a)) : [...cur, item]
      // Marcar um endereço como principal desmarca os outros.
      write(userId, item.primary ? merged.map((a) => ({ ...a, primary: a.id === id })) : merged)
      return id
    },
    [userId],
  )
  const remove = useCallback((id) => write(userId, read(userId).filter((a) => a.id !== id)), [userId])
  return { list, primary: list.find((a) => a.primary) ?? list[0], save, remove }
}

export const addressLine1 = (a) => `${a.street}${a.number ? `, ${a.number}` : ''}${a.complement ? ` (${a.complement})` : ''}${a.neighborhood ? ` — ${a.neighborhood}` : ''}`
export const addressLine2 = (a) => [a.city, a.state, a.zip].filter(Boolean).join(' · ')
