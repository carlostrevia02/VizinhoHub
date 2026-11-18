import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatBRL, formatInt, formatShare } from '../format'
import type { PaymentMethod, PaymentSlice } from '../types'
import ChartCard from './ChartCard'

// Cada forma de pagamento tem SEMPRE a mesma cor (a cor segue a entidade, não a posição no ranking).
const METHOD_VAR: Record<PaymentMethod, string> = { pix: 'var(--an-s1)', card: 'var(--an-s2)', cash: 'var(--an-s3)', unknown: 'var(--an-c)' }

function PaymentDonut({ payments }: { payments: PaymentSlice[] }) {
  const total = payments.reduce((s, p) => s + p.revenue, 0)
  const orders = payments.reduce((s, p) => s + p.orders, 0)
  const top = payments[0]
  const insight = top ? (
    <>
      <strong>{top.label}</strong> é a forma mais usada: {formatShare(top.share)} do faturamento.
    </>
  ) : (
    'Sem vendas no período.'
  )

  return (
    <ChartCard
      title="Formas de pagamento"
      insight={insight}
      table={
        <table className="an-table">
          <caption className="an-sr">Faturamento por forma de pagamento</caption>
          <thead>
            <tr>
              <th scope="col">Forma</th>
              <th scope="col" className="num">Pedidos</th>
              <th scope="col" className="num">Faturamento</th>
              <th scope="col" className="num">%</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.method}>
                <th scope="row">{p.label}</th>
                <td className="num">{formatInt(p.orders)}</td>
                <td className="num">{formatBRL(p.revenue)}</td>
                <td className="num">{formatShare(p.share)}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td colSpan={4}>Sem vendas no período.</td>
              </tr>
            )}
          </tbody>
        </table>
      }
    >
      {payments.length > 0 && (
        <div className="an-donut">
          <div className="an-donut-chart" role="img" aria-label={`Rosca de formas de pagamento. ${payments.map((p) => `${p.label} ${formatShare(p.share)}`).join(', ')}.`}>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={payments} dataKey="revenue" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={payments.length > 1 ? 2 : 0} stroke="var(--an-surface)" strokeWidth={2} isAnimationActive={false}>
                  {payments.map((p) => (
                    <Cell key={p.method} fill={METHOD_VAR[p.method]} />
                  ))}
                </Pie>
                <Tooltip
                  content={(props) => {
                    const p = props.payload?.[0]?.payload as PaymentSlice | undefined
                    if (!props.active || !p) return null
                    return (
                      <div className="an-tip">
                        <b>{p.label}</b>
                        <span>{formatBRL(p.revenue)} · {formatShare(p.share)}</span>
                        <span>{formatInt(p.orders)} {p.orders === 1 ? 'pedido' : 'pedidos'}</span>
                      </div>
                    )
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="an-donut-center" aria-hidden="true">
              <small>Total</small>
              <b>{formatBRL(total)}</b>
              <small>{formatInt(orders)} {orders === 1 ? 'pedido' : 'pedidos'}</small>
            </div>
          </div>
          <ul className="an-legend an-legend-col">
            {payments.map((p) => (
              <li key={p.method}>
                <i style={{ background: METHOD_VAR[p.method] }} aria-hidden="true" />
                <span>
                  <b>{p.label}</b> · {formatShare(p.share)}
                  <small>{formatBRL(p.revenue)} · {formatInt(p.orders)} {p.orders === 1 ? 'pedido' : 'pedidos'}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  )
}

export default PaymentDonut
