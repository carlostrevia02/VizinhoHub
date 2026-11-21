import { useCallback, useSyncExternalStore } from 'react'

// Endereços de entrega do cliente. Ainda não há endpoint na API: ficam no navegador, por usuário.
// Formato: { id, label, street, number, complement, neighborhood, city, state, zip, lat?, lng?, primary }
// Só quem está logado tem endereços salvos; visitante e conta nova começam sem nenhum (nada de exemplo).
const EMPTY = []

const storageKey = (userId) => `vizinhohub:addresses:${userId}`
const cache = new Map()
const listeners = new Set()

// Endereços de exemplo que versões antigas gravaram no navegador: descartados ao ler.
const isLegacyDemo = (a) => (a?.street === 'Rua das Flores' && String(a.number) === '120') || (a?.street === 'Av. Dom Luís' && String(a.number) === '500')

// Visitante (sem login) não tem endereços; apaga o que versões antigas guardaram na chave "guest".
try {
  localStorage.removeItem('vizinhohub:addresses:guest')
} catch {
  /* armazenamento indisponível */
}

function read(userId) {
  if (!userId) return cache.get(userId) ?? EMPTY
  if (!cache.has(userId)) {
    let list = null
    try {
      list = JSON.parse(localStorage.getItem(storageKey(userId)))
    } catch {
      /* armazenamento indisponível ou corrompido: começa vazio */
    }
    const real = Array.isArray(list) ? list.filter((a) => !isLegacyDemo(a)) : []
    if (Array.isArray(list) && real.length !== list.length) {
      try {
        localStorage.setItem(storageKey(userId), JSON.stringify(real))
      } catch {
        /* sem armazenamento: vale até recarregar */
      }
    }
    cache.set(userId, real.length ? real : EMPTY)
  }
  return cache.get(userId)
}

function write(userId, list) {
  // Garante exatamente um endereço principal.
  const primaryId = (list.find((a) => a.primary) ?? list[0])?.id
  const next = list.map((a) => ({ ...a, primary: a.id === primaryId }))
  cache.set(userId, next)
  // Visitante: só em memória (vale até recarregar); nada é gravado no navegador.
  if (userId) {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(next))
    } catch {
      /* sem armazenamento: vale até recarregar */
    }
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
