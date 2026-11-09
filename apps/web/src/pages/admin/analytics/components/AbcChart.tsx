import type { ReactElement } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatBRL, formatBRLCompact, formatInt, formatShare } from '../format'
import type { AbcClass, AbcClassSummary, AbcItem } from '../types'
import ChartCard from './ChartCard'

interface Props {
  items: AbcItem[]
  classes: AbcClassSummary[]
  totalProducts: number
  totalRevenue: number
}

const CLASS_VAR: Record<AbcClass, string> = { A: 'var(--an-a)', B: 'var(--an-b)', C: 'var(--an-c)' }
const CLASS_HELP: Record<AbcClass, string> = { A: 'campeões de venda', B: 'intermediários', C: 'vendem pouco' }
const MARGIN = { top: 8, right: 12, bottom: 0, left: 0 }
const Y_WIDTH = 64

function Tip({ active, item }: { active?: boolean; item?: AbcItem }): ReactElement | null {
  if (!active || !item) return null
  return (
    <div className="an-tip">
      <b>
        #{item.rank} · {item.name}
      </b>
      <span>Classe {item.class} · {item.category}</span>
      <span>{formatBRL(item.revenue)} ({formatShare(item.share)} do total)</span>
      <span>{formatInt(item.quantity)} {item.quantity === 1 ? 'unidade' : 'unidades'}</span>
      <span>Acumulado: {formatShare(item.cumulativeShare)}</span>
    </div>
  )
}

// Curva ABC (Pareto). Dois gráficos alinhados e sincronizados em vez de um com eixo duplo: em cima a receita de cada
// produto (barras coloridas pela classe), embaixo a participação ACUMULADA no faturamento (linha), com a marca dos 80%.
export default function AbcChart({ items, classes, totalProducts, totalRevenue }: Props) {
  const a = classes.find((c) => c.class === 'A')
  const hasData = items.length > 0
  const shown = items.length < totalProducts ? ` Mostrando os ${items.length} primeiros de ${formatInt(totalProducts)} produtos.` : ''

  const insight =
    hasData && a && a.products > 0 ? (
      <>
        <strong>
          {formatInt(a.products)} {a.products === 1 ? 'produto' : 'produtos'} ({formatShare(a.productsShare)} do cardápio)
        </strong>{' '}
        {a.products === 1 ? 'gera' : 'geram'} {formatShare(a.revenueShare)} do seu faturamento. Não deixe esses itens faltarem.{shown}
      </>
    ) : (
      'Sem vendas no período.'
    )

  return (
    <ChartCard
      title="Curva ABC de produtos"
      insight={insight}
      className="an-span-3"
      table={
        <table className="an-table">
          <caption className="an-sr">Produtos por faturamento, com classe ABC e participação acumulada</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Produto</th>
              <th scope="col">Classe</th>
              <th scope="col" className="num">Unid.</th>
              <th scope="col" className="num">Faturamento</th>
              <th scope="col" className="num">% do total</th>
              <th scope="col" className="num">% acumulado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.productId}>
                <td>{i.rank}</td>
                <th scope="row">{i.name}</th>
                <td>{i.class}</td>
                <td className="num">{formatInt(i.quantity)}</td>
                <td className="num">{formatBRL(i.revenue)}</td>
                <td className="num">{formatShare(i.share)}</td>
                <td className="num">{formatShare(i.cumulativeShare)}</td>
              </tr>
            ))}
            {!hasData && (
              <tr>
                <td colSpan={7}>Sem vendas no período.</td>
              </tr>
            )}
          </tbody>
        </table>
      }
    >
      <ul className="an-legend" aria-label="Classes da curva ABC">
        {classes.map((c) => (
          <li key={c.class}>
            <i style={{ background: CLASS_VAR[c.class] }} aria-hidden="true" />
            <span>
              <b>Classe {c.class}</b> · {CLASS_HELP[c.class]}
              <small>
                {formatInt(c.products)} {c.products === 1 ? 'produto' : 'produtos'} · {formatShare(c.revenueShare)} do faturamento ({formatBRL(c.revenue)})
              </small>
            </span>
          </li>
        ))}
      </ul>

      {hasData && (
        <div className="an-abc" role="img" aria-label={`Curva ABC: ${typeof insight === 'string' ? insight : 'poucos produtos concentram a maior parte do faturamento'}`}>
          <p className="an-axis-title">Faturamento por produto (R$) — do mais vendido ao menos vendido</p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={items} margin={MARGIN} syncId="an-abc" barCategoryGap="14%">
              <CartesianGrid stroke="var(--an-grid)" vertical={false} />
              <XAxis dataKey="rank" hide />
              <YAxis width={Y_WIDTH} tick={{ fill: 'var(--an-muted)', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={formatBRLCompact} />
              <Tooltip cursor={{ fill: 'var(--an-grid)', opacity: 0.6 }} content={(p) => <Tip active={p.active} item={p.payload?.[0]?.payload as AbcItem | undefined} />} />
              <Bar dataKey="revenue" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {items.map((i) => (
                  <Cell key={i.productId} fill={CLASS_VAR[i.class]} stroke="var(--an-surface)" strokeWidth={1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <p className="an-axis-title">Participação acumulada no faturamento (%) — posição do produto no ranking</p>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={items} margin={{ ...MARGIN, bottom: 4 }} syncId="an-abc">
              <CartesianGrid stroke="var(--an-grid)" vertical={false} />
              <XAxis dataKey="rank" tick={{ fill: 'var(--an-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--an-axis)' }} interval="preserveStartEnd" minTickGap={10} />
              <YAxis
                width={Y_WIDTH}
                domain={[0, 1]}
                ticks={[0, 0.5, 0.8, 1]}
                tick={{ fill: 'var(--an-muted)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              />
              <ReferenceLine y={0.8} stroke="var(--an-muted)" strokeDasharray="5 4" label={{ value: '80%', position: 'insideBottomRight', fill: 'var(--an-muted)', fontSize: 12 }} />
              <Tooltip cursor={{ stroke: 'var(--an-axis)', strokeDasharray: '4 4' }} content={(p) => <Tip active={p.active} item={p.payload?.[0]?.payload as AbcItem | undefined} />} />
              <Line type="monotone" dataKey="cumulativeShare" stroke="var(--an-s2)" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: 'var(--an-surface)', strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="an-foot">Total do período: {formatBRL(totalRevenue)}. A linha laranja mostra quanto do faturamento os produtos de 1 até a posição indicada já somam.</p>
        </div>
      )}
    </ChartCard>
  )
}
