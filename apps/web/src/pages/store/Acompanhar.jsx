import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { api, ApiError } from '../../lib/api'
import DeliveryTracker from '../../components/DeliveryTracker'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { useRealtime } from '../../lib/realtime'
import { formatWhen, orderCode } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import NotFound from '../NotFound'

// Etapas do pedido, na ordem; cada uma diz o que está acontecendo quando ela é a atual.
const STEPS = [
  { status: 'PENDING', title: 'Pedido recebido', note: (loja) => `${loja} recebeu seu pedido e vai confirmar em instantes` },
  { status: 'IN_PREPARATION', title: 'Em preparação', note: () => 'Estamos separando seus itens' },
  { status: 'READY', title: 'Pronto para retirada', note: () => 'Pode vir buscar — ou aguarde a entrega no bairro' },
  { status: 'COMPLETED', title: 'Entregue', note: () => 'Pedido concluído. Obrigado!' },
]
const FILL = ['12%', '38%', '64%', '100%']

function Acompanhar() {
  const { id } = useParams()
  // Rota antiga sem id: a lista de pedidos fica em Minha conta.
  if (!id) return <Navigate to="/conta" replace />
  return <Pedido key={id} id={id} />
}

function Pedido({ id }) {
  useDocumentTitle(`Acompanhar pedido #${orderCode(id)} — VizinhoHub`)
  const { token } = useAuth()
  const { getProduct } = useCatalog()
  const [order, setOrder] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | notfound | error

  useEffect(() => {
    let cancelled = false
    const fetchOrder = async () => {
      try {
        const o = await api.get(`/orders/${id}`)
        if (cancelled) return
        setOrder(o)
        setState('ok')
      } catch (err) {
        if (cancelled) return
        console.error('Não foi possível carregar o pedido:', err)
        setState(err instanceof ApiError && (err.status === 404 || err.status === 400) ? 'notfound' : 'error')
      }
    }
    fetchOrder()
    return () => {
      cancelled = true
    }
  }, [id])

  // O comerciante muda o status → a tela atualiza sozinha.
  useRealtime(token, {
    'order:status_updated': (o) => o.id === id && setOrder(o),
  })

  if (state === 'loading') return <main><p className="muted">Carregando pedido…</p></main>
  if (state === 'notfound') return <NotFound />
  if (state === 'error') {
    return (
      <main>
        <h1 className="page-title">Não foi possível carregar o pedido</h1>
        <Link className="btn" to="/conta">Voltar para Minha conta</Link>
      </main>
    )
  }

  const store = getProduct(order.items[0]?.productId)?.store.name ?? 'A loja'
  const cancelled = order.status === 'CANCELLED'
  const current = STEPS.findIndex((s) => s.status === order.status)
  const delivery = order.contact.deliveryMethod ?? 'Retirada na loja'

  return (
    <main>
      <nav className="crumbs">
        <Link to="/conta">Minha conta</Link> › <span>Pedido #{orderCode(order.id)}</span>
      </nav>
      <h1 className="page-title">Acompanhar pedido #{orderCode(order.id)}</h1>
      <p className="sub">Atualizamos o status em tempo real — não precisa recarregar a página.</p>
      <div className="grid-2">
        <section className="panel sk sk-lines" aria-label="Status do pedido">
          <h3>Status do pedido</h3>
          {cancelled ? (
            <p>
              <span className="tag low">Cancelado</span>{' '}
              <span className="muted">{store} cancelou este pedido em {formatWhen(order.updatedAt)}. Se tiver dúvidas, fale com a loja.</span>
            </p>
          ) : (
            <ol className="timeline">
              <span className="fill" style={{ '--h': FILL[current] }} />
              {STEPS.map((s, i) => (
                <li key={s.status} className={i < current || order.status === 'COMPLETED' ? 'done' : i === current ? 'now' : undefined}>
                  <span className="dot-s">{i < current || order.status === 'COMPLETED' ? '✓' : ''}</span>
                  <strong>{s.title}</strong>
                  <span className="muted">
                    {i === 0
                      ? `${formatWhen(order.createdAt)} — ${s.note(store)}`
                      : i === current
                        ? `${formatWhen(order.updatedAt)} — ${s.note(store)}`
                        : i < current
                          ? 'Concluído'
                          : 'Em breve'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel sk sk-lines" style={{ '--i': 2 }} aria-label="Resumo">
          <h3>Resumo</h3>
          {order.items.map((i) => {
            const p = getProduct(i.productId)
            return (
              <div className="line" key={i.productId}>
                <span className="item">
                  <img src={imgSrc(p ?? {})} alt="" width="96" height="96" loading="lazy" />
                  <span>
                    {i.name}
                    <br />
                    <span className="muted">{i.quantity}× {formatBRL(i.unitPrice)}</span>
                  </span>
                </span>
                <strong>{formatBRL(i.quantity * i.unitPrice)}</strong>
              </div>
            )
          })}
          <div className="summary-row">
            <span>Entrega</span>
            <span>{delivery}</span>
          </div>
          {order.contact.notes && (
            <div className="summary-row">
              <span>Observações</span>
              <span>{order.contact.notes}</span>
            </div>
          )}
          {order.vipSavings > 0 && (
            <div className="summary-row">
              <span><span className="tag ok">VIP</span> Você economizou</span>
              <span>{formatBRL(order.vipSavings)}</span>
            </div>
          )}
          <div className="summary-row">
            <strong>Total</strong>
            <strong>{formatBRL(order.totalPrice)}</strong>
          </div>
        </section>
      </div>
      {order.status !== 'CANCELLED' && /entrega/i.test(order.contact.deliveryMethod ?? '') && <DeliveryTracker orderId={order.id} orderStatus={order.status} />}
    </main>
  )
}

export default Acompanhar
