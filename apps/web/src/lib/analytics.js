import { useEffect, useState } from 'react'
import { api, qs } from './api'

// Números do painel (Dashboard e Relatórios) vêm de GET /reports/summary: o servidor soma todos os pedidos do
// período (cancelados fora das vendas), em vez de o navegador somar só a página de pedidos que baixou.

const TZ = 'America/Fortaleza' // o "dia" do servidor
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Hoje (AAAA-MM-DD) no fuso da loja. */
export const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())

/** O dia `n` dias antes de `key` (AAAA-MM-DD). */
export const daysBefore = (key, n) => new Date(Date.parse(key) - n * 86_400_000).toISOString().slice(0, 10)

export const weekdayLabel = (key) => WEEKDAYS[new Date(`${key}T12:00:00Z`).getUTCDay()]

/**
 * Resumo da loja dos últimos `days` dias (o último é hoje). `refreshKey` muda quando chegam pedidos novos:
 * o resumo é pedido de novo (com um pequeno atraso) sem apagar o que já está na tela. `summary` é null enquanto carrega.
 */
export function useSummary(token, days, top, refreshKey) {
  const [state, setState] = useState({ summary: null, error: false, tick: 0 })
  const { tick } = state

  useEffect(() => {
    if (!token) return undefined
    let cancelled = false
    const timer = setTimeout(async () => {
      const to = todayKey()
      try {
        const summary = await api.get(`/reports/summary${qs({ from: daysBefore(to, days - 1), to, top })}`)
        if (!cancelled) setState((s) => ({ ...s, summary, error: false }))
      } catch (err) {
        console.error('Não foi possível carregar o resumo da loja:', err)
        if (!cancelled) setState((s) => ({ ...s, error: true }))
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [token, days, top, refreshKey, tick])

  // Trocar de período não mostra os números do período anterior.
  const fresh = state.summary && state.summary.to === todayKey() && state.summary.from === daysBefore(state.summary.to, days - 1)
  return {
    summary: fresh ? state.summary : null,
    error: state.error,
    reload: () => setState((s) => ({ ...s, error: false, tick: s.tick + 1 })),
  }
}

/** Faturamento por departamento (os `keep` maiores + "Outros"), em % do total. `byCategory` já vem do servidor. */
export function departments(byCategory, keep = 4) {
  const total = byCategory.reduce((s, c) => s + c.revenue, 0)
  if (total === 0) return []
  const head = byCategory.slice(0, keep).map((c) => [c.name, c.revenue])
  const rest = byCategory.slice(keep).reduce((s, c) => s + c.revenue, 0)
  const rows = rest > 0 ? [...head, ['Outros', rest]] : head
  return rows.map(([name, value]) => ({ name, value, pct: Math.round((value / total) * 100) }))
}

export const DONUT_COLORS = ['#1f7a4d', '#f59e0b', '#3b82f6', '#e11d48', '#94a3b8']

/** Variáveis CSS do gráfico de rosca (.donut usa --cN e as porcentagens acumuladas --aN). */
export function donutStyle(rows) {
  const style = {}
  let acc = 0
  rows.forEach((r, i) => {
    style[`--c${i + 1}`] = DONUT_COLORS[i]
    acc += r.value
    if (i < rows.length - 1) style[`--a${i + 1}`] = `${Math.round((acc / rows.reduce((s, x) => s + x.value, 0)) * 100)}%`
  })
  return style
}
