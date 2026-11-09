import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCatalog } from '../context/CatalogContext'
import { imgSrc } from '../lib/catalog'
import { formatBRL } from '../lib/format'
import { formatWhen, orderCode, statusInfo, useOrders } from '../lib/useOrders'

export default function MyOrders() {
  const { token, isMerchant } = useAuth()
  const { getProduct } = useCatalog()
  // Para o comerciante a API devolve os pedidos recebidos pela loja, que ficam no painel — não aqui.
  const { orders, error } = useOrders(isMerchant ? null : token, { limit: 50 })

  if (isMerchant) {
    return (
      <p className="muted">
        Esta é uma conta de comerciante: os pedidos da sua loja ficam no <Link to="/manager" className="link-green">painel de pedidos</Link>.
      </p>
    )
  }
  if (error) return <p className="muted">Não foi possível carregar seus pedidos agora.</p>
  if (!orders) return <p className="muted">Carregando pedidos…</p>
  if (orders.length === 0) {
    return (
      <p className="muted">
        Você ainda não fez pedidos. <Link to="/produtos" className="link-green">Ver produtos</Link>
      </p>
    )
  }

  return (
    <div className="orders-list">
      {orders.map((o) => {
        const { tone, label } = statusInfo(o.status)
        const count = o.items.reduce((n, i) => n + i.quantity, 0)
        return (
          <Link className="order-row" key={o.id} to={`/acompanhar/${o.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="thumbs">
              {o.items.slice(0, 3).map((i) => {
                const p = getProduct(i.productId)
                return p && <img key={i.productId} src={imgSrc(p)} alt="" width="96" height="96" loading="lazy" />
              })}
            </div>
            <div>
              <strong>Pedido #{orderCode(o.id)}</strong>
              <br />
              <span className="muted">
                {formatWhen(o.createdAt)} · {count} {count === 1 ? 'item' : 'itens'} · {formatBRL(o.totalPrice)}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className={`tag ${tone}`}>{label}</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
