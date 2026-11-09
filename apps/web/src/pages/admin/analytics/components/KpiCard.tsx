import type { ReactNode } from 'react'

export interface Delta {
  /** Texto curto: "+12,3%" / "−4,0%" / "Novo". */
  text: string
  tone: 'up' | 'down' | 'flat' | 'new'
  /** Frase para leitores de tela: "subiu 12,3% em relação ao período anterior". */
  spoken: string
}

interface Props {
  label: string
  value: string
  delta: Delta
  /** Linha de apoio: valor do período anterior, ou o "2 de 3 ofertas…" da conversão. */
  footnote: ReactNode
  hint?: string
}

const ICON = { up: '▲', down: '▼', flat: '■', new: '●' } as const

// Cartão de indicador: número grande + variação com ÍCONE, SINAL e cor (nunca só cor).
export default function KpiCard({ label, value, delta, footnote, hint }: Props) {
  return (
    <article className="an-kpi" aria-label={label}>
      <h3 title={hint}>{label}</h3>
      <p className="an-kpi-value">{value}</p>
      <p className={`an-delta ${delta.tone}`}>
        <span aria-hidden="true">{ICON[delta.tone]}</span> {delta.text}
        <span className="an-sr"> — {delta.spoken}</span>
      </p>
      <p className="an-kpi-foot">{footnote}</p>
    </article>
  )
}

/** Variação relativa (%) → texto/tom. `null` = sem período anterior para comparar. */
export function deltaFromPct(changePct: number | null, nf: (n: number) => string): Delta {
  if (changePct === null) return { text: 'Novo', tone: 'new', spoken: 'sem dados no período anterior para comparar' }
  if (Math.abs(changePct) < 0.05) return { text: '0,0%', tone: 'flat', spoken: 'igual ao período anterior' }
  const up = changePct > 0
  const text = `${up ? '+' : '−'}${nf(Math.abs(changePct))}`
  return { text, tone: up ? 'up' : 'down', spoken: `${up ? 'subiu' : 'caiu'} ${nf(Math.abs(changePct))} em relação ao período anterior` }
}

/** Variação em pontos percentuais (para taxas, como a conversão). */
export function deltaFromPoints(current: number, previous: number, hasPrevious: boolean): Delta {
  if (!hasPrevious) return { text: 'Novo', tone: 'new', spoken: 'sem dados no período anterior para comparar' }
  const diff = Math.round((current - previous) * 10) / 10
  if (diff === 0) return { text: '0,0 p.p.', tone: 'flat', spoken: 'igual ao período anterior' }
  const text = `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1).replace('.', ',')} p.p.`
  return { text, tone: diff > 0 ? 'up' : 'down', spoken: `${diff > 0 ? 'subiu' : 'caiu'} ${text.slice(1)} em relação ao período anterior` }
}
