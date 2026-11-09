import { useCallback, useEffect, useState } from 'react'
import { api, qs } from '../../../lib/api'
import type { AnalyticsDashboard, DateRange } from './types'

interface State {
  data: AnalyticsDashboard | null
  error: string | null
  loading: boolean
}

/**
 * Carrega o dashboard sempre que o período ou o status mudam. Mantém os dados anteriores na tela enquanto a
 * nova resposta chega (sem piscar) e descarta respostas atrasadas de um filtro que já foi trocado.
 * `range = null` = período inválido (nada é pedido à API).
 */
export function useAnalytics(range: DateRange | null, status: string) {
  const [state, setState] = useState<State>({ data: null, error: null, loading: Boolean(range) })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const start = range?.startDate
  const end = range?.endDate
  useEffect(() => {
    if (!start || !end) return
    let stale = false
    setState((s) => ({ ...s, loading: true, error: null }))
    api
      .get(`/analytics/dashboard${qs({ startDate: start, endDate: end, status })}`)
      .then((data: AnalyticsDashboard) => {
        if (!stale) setState({ data, error: null, loading: false })
      })
      .catch((err: Error) => {
        if (!stale) setState((s) => ({ ...s, loading: false, error: err.message || 'Não foi possível carregar os dados.' }))
      })
    return () => {
      stale = true
    }
  }, [start, end, status, nonce])

  return { ...state, reload }
}
