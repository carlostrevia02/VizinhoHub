import { useId, useState, type ReactNode } from 'react'

interface Props {
  title: string
  /** Frase em português simples que diz o que o gráfico mostra ("Seu pico é às 12h"). */
  insight?: ReactNode
  /** Controles extras no cabeçalho (ex.: alternar faturamento/pedidos). */
  actions?: ReactNode
  /** Mesma informação em tabela — alternativa acessível ao gráfico. */
  table: ReactNode
  children: ReactNode
  className?: string
}

export default function ChartCard({ title, insight, actions, table, children, className }: Props) {
  const [asTable, setAsTable] = useState(false)
  const bodyId = useId()
  return (
    <section className={`an-card ${className ?? ''}`} aria-labelledby={`${bodyId}-t`}>
      <header className="an-card-head">
        <div>
          <h2 id={`${bodyId}-t`}>{title}</h2>
          {insight && <p className="an-insight">{insight}</p>}
        </div>
        <div className="an-card-actions">
          {!asTable && actions}
          <button type="button" className="an-link" aria-pressed={asTable} aria-controls={bodyId} onClick={() => setAsTable((v) => !v)}>
            {asTable ? 'Ver gráfico' : 'Ver como tabela'}
          </button>
        </div>
      </header>
      <div id={bodyId}>{asTable ? <div className="an-table-wrap">{table}</div> : children}</div>
    </section>
  )
}
