import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatBRL, formatBRLCompact, formatInt } from '../format'
import type { HourlyPoint } from '../types'
import ChartCard from './ChartCard'

type Metric = 'revenue' | 'orders'

interface Props {
  hourly: HourlyPoint[]
  peak: HourlyPoint | null
}

const METRICS: { id: Metric; label: string }[] = [
  { id: 'revenue', label: 'Faturamento' },
  { id: 'orders', label: 'Pedidos' },
]

// Vendas por hora do dia (somadas no período inteiro): onde estão os horários de pico.
export default function HourlySalesChart({ hourly, peak }: Props) {
  const [metric, setMetric] = useState<Metric>('revenue')
  const money = metric === 'revenue'
  const hasSales = hourly.some((h) => h.orders > 0)
  const peakPoint = peak && (money ? peak : hourly.reduce((a, h) => (h.orders > a.orders ? h : a), hourly[0]!))
  const nf = (n: number) => (money ? formatBRL(n) : `${formatInt(n)} ${n === 1 ? 'pedido' : 'pedidos'}`)

  const insight = !hasSales ? (
    'Sem vendas no período.'
  ) : peak ? (
    <>
      Seu horário mais forte é às <strong>{peak.label}</strong>: {formatBRL(peak.revenue)} em {formatInt(peak.orders)} {peak.orders === 1 ? 'pedido' : 'pedidos'}.
    </>
  ) : null

  return (
    <ChartCard
      title="Picos de venda por hora"
      insight={insight}
      className="an-span-2"
      actions={
        <div className="an-seg sm" role="group" aria-label="Medida do gráfico">
          {METRICS.map((m) => (
            <button key={m.id} type="button" aria-pressed={metric === m.id} className={metric === m.id ? 'on' : undefined} onClick={() => setMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      }
      table={
        <table className="an-table">
          <caption className="an-sr">Pedidos e faturamento por hora do dia</caption>
          <thead>
            <tr>
              <th scope="col">Hora</th>
              <th scope="col" className="num">Pedidos</th>
              <th scope="col" className="num">Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {hourly.filter((h) => h.orders > 0).map((h) => (
              <tr key={h.hour}>
                <th scope="row">{h.label}</th>
                <td className="num">{formatInt(h.orders)}</td>
                <td className="num">{formatBRL(h.revenue)}</td>
              </tr>
            ))}
            {!hasSales && (
              <tr>
                <td colSpan={3}>Sem vendas no período.</td>
              </tr>
            )}
          </tbody>
        </table>
      }
    >
      <div className="an-chart" role="img" aria-label={typeof insight === 'string' ? insight : `Gráfico de área: ${money ? 'faturamento' : 'pedidos'} por hora. Pico às ${peak?.label ?? '—'}.`}>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={hourly} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="an-hour-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--an-s1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--an-s1)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--an-grid)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--an-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--an-axis)' }} interval="preserveStartEnd" minTickGap={14} />
            <YAxis
              width={money ? 76 : 36}
              tick={{ fill: 'var(--an-muted)', fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tickFormatter={(v: number) => (money ? formatBRLCompact(v) : String(v))}
            />
            <Tooltip
              cursor={{ stroke: 'var(--an-axis)', strokeDasharray: '4 4' }}
              content={(props) => {
                const p = props.payload?.[0]?.payload as HourlyPoint | undefined
                if (!props.active || !p) return null
                return (
                  <div className="an-tip">
                    <b>{p.label}</b>
                    <span>{formatBRL(p.revenue)}</span>
                    <span>{formatInt(p.orders)} {p.orders === 1 ? 'pedido' : 'pedidos'}</span>
                  </div>
                )
              }}
            />
            <Area type="monotone" dataKey={metric} stroke="var(--an-s1)" strokeWidth={2} fill="url(#an-hour-fill)" activeDot={{ r: 5, stroke: 'var(--an-surface)', strokeWidth: 2 }} isAnimationActive={false} />
            {hasSales && peakPoint && (
              <ReferenceDot
                x={peakPoint.label}
                y={money ? peakPoint.revenue : peakPoint.orders}
                r={6}
                fill="var(--an-s2)"
                stroke="var(--an-surface)"
                strokeWidth={2}
                label={{ value: `Pico ${peakPoint.label} · ${nf(money ? peakPoint.revenue : peakPoint.orders)}`, position: 'top', fill: 'var(--an-text)', fontSize: 12, fontWeight: 600 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
