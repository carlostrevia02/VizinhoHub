import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, qs } from './api'
import { BAIRRO, getPosition } from './flash'

// Carrinho Inteligente: receitas, listas de compras e otimizador de lojas (API /smart-cart).
export const searchCanonicals = (q, limit = 8) => api.get(`/smart-cart/canonicals${qs({ q, limit })}`)
export const listRecipes = (q) => api.get(`/smart-cart/recipes${qs({ q })}`)
export const getRecipe = (slug) => api.get(`/smart-cart/recipes/${encodeURIComponent(slug)}`)

export const listLists = () => api.get('/smart-cart/lists')
export const createList = (body) => api.post('/smart-cart/lists', body)
export const createListFromRecipe = (body) => api.post('/smart-cart/lists/from-recipe', body)
export const renameList = (id, title) => api.put(`/smart-cart/lists/${id}`, { title })
export const deleteList = (id) => api.delete(`/smart-cart/lists/${id}`)
export const addListItem = (id, item) => api.post(`/smart-cart/lists/${id}/items`, item)
export const removeListItem = (id, itemId) => api.delete(`/smart-cart/lists/${id}/items/${itemId}`)

/** source: { listId } | { recipeSlug, servings } | { items: [{ canonicalId, quantity }] } */
export const optimizeCart = (source, place, extra = {}) => api.post('/smart-cart/optimize', { ...source, lat: place.lat, lng: place.lng, ...extra })

/** Mensagem amigável para um erro da API. */
export const errorText = (err, fallback = 'Não foi possível concluir agora. Tente novamente.') =>
  err instanceof ApiError && (err.code === 'NETWORK' || (err.status >= 400 && err.status < 500 && err.status !== 401)) ? err.message : fallback

/**
 * Posição do cliente para comparar lojas. Sem permissão, parte do bairro da vitrine (`fallback: true`).
 * Devolve { place, fallback, locate } — `place` é null enquanto descobre.
 */
export function usePlace() {
  const [state, setState] = useState({ place: null, fallback: false })
  const locate = useCallback(() => {
    setState({ place: null, fallback: false })
    getPosition()
      .then((p) => setState({ place: p, fallback: false }))
      .catch(() => setState({ place: { lat: BAIRRO.lat, lng: BAIRRO.lng }, fallback: true }))
  }, [])
  useEffect(locate, [locate])
  return { ...state, locate }
}

/** Quantidade para mostrar: até 2 casas, sem zeros sobrando ("0,5", "2"). */
export const formatQty = (n) => String(Math.round(n * 100) / 100).replace('.', ',')
