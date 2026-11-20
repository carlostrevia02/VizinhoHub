import { formatBRL, formatInt, formatShare } from '../format'
import type { ChannelsBreakdown } from '../types'
import ChartCard from './ChartCard'

const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`

// Divisão do faturamento entre pedido online e cupom de oferta. A cor segue o canal (cupom = mesma cor da rosca).
function ChannelsCard({ channels }: { channels: ChannelsBreakdown }) {
  const { online, coupon } = channels
  const total = online.revenue + coupon.revenue
  const onlineShare = total > 0 ? online.revenue / total : 0
  const couponShare = total > 0 ? coupon.revenue / total : 0
  const empty = online.orders + coupon.orders === 0

  const insight = empty ? (
    'Sem compras confirmadas no período.'
  ) : (
    <>
      <strong>{couponShare > onlineShare ? 'Cupom de oferta' : 'Pedido online'}</strong> responde por {formatShare(Math.max(onlineShare, couponShare))} do faturamento.
    </>
  )

  const rows = [
    { key: 'online', name: 'Pedido online', color: 'var(--an-s1)', orders: online.orders, revenue: online.revenue, share: onlineShare },
    { key: 'coupon', name: 'Cupom de oferta', color: 'var(--an-s4)', orders: coupon.orders, revenue: coupon.revenue, share: couponShare },
  ]

  return (
    <ChartCard
      title="Canais de venda"
      insight={insight}
      table={
        <table className="an-table">
          <caption className="an-sr">Faturamento por canal de venda</caption>
          <thead>
            <tr>
              <th scope="col">Canal</th>
              <th scope="col" className="num">Compras</th>
              <th scope="col" className="num">Faturamento</th>
              <th scope="col" className="num">%</th>
              <th scope="col" className="num">Lucro</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.name}</th>
                <td className="num">{formatInt(r.orders)}</td>
                <td className="num">{formatBRL(r.revenue)}</td>
                <td className="num">{formatShare(r.share)}</td>
                <td className="num">{r.key === 'coupon' ? formatBRL(coupon.profit) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {empty ? (
        <p className="an-rank-empty">Quando houver pedidos online ou cupons confirmados, a divisão aparece aqui.</p>
      ) : (
        <ul className="an-channels">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="an-channel-top">
                <span className="an-channel-name">
                  <i style={{ background: r.color }} aria-hidden="true" />
                  {r.name}
                </span>
                <span className="an-channel-value">{formatBRL(r.revenue)}</span>
              </div>
              <div className="an-bar" role="img" aria-label={`${r.name}: ${formatShare(r.share)} do faturamento`}>
                <span style={{ width: `${(r.share * 100).toFixed(2)}%`, background: r.color }} />
              </div>
              <p className="an-channel-meta">
                {formatShare(r.share)} do faturamento · {plural(r.orders, 'compra', 'compras')}
                {r.key === 'coupon' && (
                  <>
                    {' '}· Lucro do VizinhoHub: <b>{formatBRL(coupon.profit)}</b>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  )
}

export default ChannelsCard
