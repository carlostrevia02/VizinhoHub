import { Link } from 'react-router-dom'
import { useAdmin } from '../../context/AdminContext'
import { useAuth } from '../../context/AuthContext'
import { DONUT_COLORS, byDepartment, donutStyle, lastDays, sales, sum, topProducts } from '../../lib/analytics'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { customerName, isToday, orderCode, statusInfo } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const LOW_STOCK = 5

export default function Dashboard() {
  useDocumentTitle('Dashboard — VizinhoHub Manager')
  const { user } = useAuth()
  const { orders, ordersError, reloadOrders, products } = useAdmin()

  if (ordersError) {
    return (
      <>
        <h1 className="page-title">Dashboard</h1>
        <p className="sub">Não foi possível carregar os pedidos.</p>
        <button className="btn" type="button" onClick={reloadOrders}>Tentar de novo</button>
      </>
    )
  }
  if (!orders) return <p className="muted">Carregando painel…</p>

  const today = sales(orders.filter((o) => isToday(o.createdAt)))
  const revenue = sum(today)
  const ticket = today.length ? revenue / today.length : 0
  const critical = (products ?? []).filter((p) => p.active && p.stockQty <= LOW_STOCK).sort((a, b) => a.stockQty - b.stockQty)
  const week = lastDays(orders, 7)
  const weekMax = Math.max(...week.map((d) => d.total), 1)
  const depts = byDepartment(orders, products)
  const top = topProducts(orders, 5)
  const topMax = top[0]?.qty ?? 1
  const imageOf = new Map((products ?? []).map((p) => [p.id, p.image]))

  return (
    <>
      <div className="row" style={{ marginBottom: '6px' }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="sub" style={{ margin: 0 }}>Resumo da operação de {user.store?.name ?? 'sua loja'} hoje.</p>
        </div>
        <Link className="btn" to="/manager">Abrir mural de pedidos</Link>
      </div>
      <p />
      <div className="stats">
        <div className="stat sk sk-stat">
          <span className="muted">Pedidos hoje</span>
          <b>{today.length}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 1 }}>
          <span className="muted">Faturamento</span>
          <b>{formatBRL(revenue)}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 2 }}>
          <span className="muted">Ticket médio</span>
          <b>{formatBRL(ticket)}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 3 }}>
          <span className="muted">Estoque baixo</span>
          <b style={{ color: 'var(--red)' }}>{products ? critical.length : '–'}</b>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel sk sk-lines">
          <h3>Vendas da semana</h3>
          <div className="bars">
            {week.map((d, i) => (
              <div className="bar" style={{ '--k': i }} key={d.key}>
                <b>{formatBRL(Math.round(d.total)).replace(',00', '')}</b>
                <i style={{ '--h': `${d.total > 0 ? Math.max(4, Math.round((d.total / weekMax) * 100)) : 2}%` }} />
              </div>
            ))}
          </div>
          <div className="bars-x">{week.map((d) => <span key={d.key}>{d.label}</span>)}</div>
        </section>

        <section className="panel sk sk-lines" style={{ '--i': 1 }}>
          <h3>Vendas por departamento</h3>
          {depts.length === 0 ? (
            <p className="muted">Ainda não há vendas para mostrar.</p>
          ) : (
            <div className="donut-wrap">
              <div className="donut" style={donutStyle(depts)} role="img" aria-label="Gráfico de vendas por departamento" />
              <div className="legend">
                {depts.map((d, i) => (
                  <div style={{ '--k': i }} key={d.name}>
                    <i style={{ background: DONUT_COLORS[i] }} />
                    {d.name} <b>{d.pct}%</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: '1fr 1fr 1.5fr' }}>
        <section className="panel">
          <h3>Mais vendidos</h3>
          {top.length === 0 ? (
            <p className="muted">Sem vendas ainda.</p>
          ) : (
            <ul className="rank">
              {top.map((p, i) => (
                <li style={{ '--k': i }} key={p.productId}>
                  <img src={imgSrc({ img: imageOf.get(p.productId) })} alt="" width="96" height="96" loading="lazy" />
                  <div className="grow">
                    <span>{p.name}</span>
                    <div className="hbar"><i style={{ '--w': `${Math.round((p.qty / topMax) * 100)}%` }} /></div>
                  </div>
                  <b>{p.qty} un</b>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h3>Estoque crítico</h3>
          {!products ? (
            <p className="muted">Carregando…</p>
          ) : critical.length === 0 ? (
            <p className="muted">Nenhum produto com estoque baixo.</p>
          ) : (
            <ul className="rank">
              {critical.slice(0, 7).map((p, i) => (
                <li style={{ '--k': i }} key={p.id}>
                  <img src={imgSrc({ img: p.image })} alt="" width="96" height="96" loading="lazy" />
                  <div className="grow"><span>{p.name}</span></div>
                  <span className="tag low">{p.stockQty === 0 ? 'Esgotado' : `${p.stockQty} un`}</span>
                </li>
              ))}
            </ul>
          )}
          <p style={{ marginBottom: 0 }}>
            <Link className="btn ghost sm" to="/estoque">Ver estoque</Link>
          </p>
        </section>

        <section className="panel">
          <h3>Últimos pedidos</h3>
          {orders.length === 0 ? (
            <p className="muted">Nenhum pedido ainda.</p>
          ) : (
            <table className="spec">
              <thead>
                <tr>
                  <th style={{ width: 'auto' }}>Pedido</th>
                  <th style={{ width: 'auto' }}>Cliente</th>
                  <th style={{ width: 'auto' }}>Total</th>
                  <th style={{ width: 'auto' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 5).map((o, i) => {
                  const { tone, label } = statusInfo(o.status)
                  return (
                    <tr style={{ '--i': i }} key={o.id}>
                      <td><Link style={{ color: 'var(--green)', fontWeight: 700 }} to={`/pedido-detalhe?id=${o.id}`}>#{orderCode(o.id)}</Link></td>
                      <td>{customerName(o)}</td>
                      <td>{formatBRL(o.totalPrice)}</td>
                      <td><span className={`tag ${tone}`}>{label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  )
}
