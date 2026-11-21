import { useEffect, useState } from 'react'
import { listDeals } from './deals'

// Filial mais próxima de cada oferta, em uma 2ª requisição (a mesma busca + lat/lng). A lista de ofertas
// aparece sem esperar a rota (o OSRM público pode demorar); aqui só chega o mapa id → nearestBranch.
// Sem `coords` nada é pedido nem enviado. Falha de rede é silenciosa: a oferta só fica sem a linha.
// Devolve { branches: { [dealId]: nearestBranch|null }, pending: boolean }.
export function useDealBranches(params, coords) {
  const key = coords ? JSON.stringify([params, coords.lat, coords.lng]) : null
  const [done, setDone] = useState({ key: null, branches: {} })

  useEffect(() => {
    if (!key) return
    let alive = true
    const t = setTimeout(async () => {
      try {
        const list = await listDeals({ ...params, lat: coords.lat, lng: coords.lng })
        if (alive) setDone({ key, branches: Object.fromEntries(list.map((d) => [d.id, d.nearestBranch ?? null])) })
      } catch {
        if (alive) setDone({ key, branches: {} })
      }
    }, 300) // acompanha o debounce da busca
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` resume params e coords
  }, [key])

  if (!key) return { branches: {}, pending: false }
  return { branches: done.branches, pending: done.key !== key }
}
