import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useClientLocation } from './clientLocation'
import { BAIRRO, getRadar } from './flash'

// Ofertas relâmpago (Tá Quentinho) por produto, para o cartão do produto mostrar a promoção ali mesmo.
// UMA chamada ao radar para a página toda (máx. 100, o limite da API), renovada a cada 30 s.
// Não pede GPS: usa a localização que o site já tem (entrega/"Usar minha localização") ou o ponto de referência.
// Falha de rede é silenciosa: sem ofertas, os cartões ficam como sempre foram.
const NONE = new Map()
const FlashOffersContext = createContext(NONE)

// productId -> oferta; havendo mais de uma para o mesmo produto, vale a de menor preço.
export function indexOffers(list) {
  const map = new Map()
  for (const o of list) {
    const cur = map.get(o.productId)
    if (!cur || o.offerPrice < cur.offerPrice) map.set(o.productId, o)
  }
  return map
}

const sameOffers = (a, b) =>
  a.size === b.size &&
  [...b].every(([k, o]) => {
    const c = a.get(k)
    return c && c.id === o.id && c.offerPrice === o.offerPrice && c.qtyAvailable === o.qtyAvailable && c.endsAt === o.endsAt
  })

export function FlashOffersProvider({ children }) {
  const { user } = useAuth()
  const { coords } = useClientLocation(user?.id)
  const lat = coords?.lat ?? BAIRRO.lat
  const lng = coords?.lng ?? BAIRRO.lng
  const [offers, setOffers] = useState(NONE)

  const load = useCallback(async () => {
    try {
      const next = indexOffers(await getRadar({ lat, lng, limit: 100 }))
      setOffers((cur) => (sameOffers(cur, next) ? cur : next)) // sem mudança, não re-renderiza os cartões
    } catch {
      /* falha de rede: silenciosa, mantém o que já estava na tela */
    }
  }, [lat, lng])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  return <FlashOffersContext.Provider value={offers}>{children}</FlashOffersContext.Provider>
}

/** Oferta relâmpago ativa do produto ou null (também fora do provider). */
export function useFlashOffer(productId) {
  return useContext(FlashOffersContext).get(productId) ?? null
}
