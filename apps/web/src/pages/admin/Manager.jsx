import { useState } from 'react'
import { ADVANCE_LABEL, useAdmin } from '../../context/AdminContext'
import { formatBRL } from '../../lib/format'
import { customerName, formatTime, isToday, orderCode, statusInfo } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const STEP = { PENDING: 1, IN_PREPARATION: 2, READY: 3, COMPLETED: 4 }
const LOW_STOCK = 5

function Manager() {
  useDocumentTitle('VizinhoHub Manager — Pedidos')
  const { orders, ordersError, reloadOrders, products } = useAdmin()

  if (ordersError) {
    return (
      <>
        <h1 className="page-title">Mural de pedidos</h1>
        <p className="sub">Não foi possível carregar os pedidos.</p>
        <button className="btn" type="button" onClick={reloadOrders}>Tentar de novo</button>
      </>
    )
  }
  if (!orders) return <p className="muted">Carregando pedidos…</p>

  const today = orders.filter((o) => isToday(o.createdAt))
  const revenue = today.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.totalPrice, 0)
  const waiting = orders.filter((o) => o.status === 'PENDING').length
  const lowStock = products?.filter((p) => p.active && p.stockQty <= LOW_STOCK).length

  const columns = [
    { key: 'new', title: 'Novos Pedidos', dot: 'y', tag: 'new', label: 'Novos pedidos', list: orders.filter((o) => o.status === 'PENDING') },
    { key: 'prep', title: 'Em Preparação', dot: 'b', tag: 'prep', label: 'Em preparação', list: orders.filter((o) => o.status === 'IN_PREPARATION') },
    {
      key: 'done',
      title: 'Prontos / Entregues',
      dot: 'g',
      tag: 'ok',
      label: 'Prontos e entregues',
      // Entregues só do dia, para o mural não crescer sem fim (o histórico está em "Pedidos").
      list: orders.filter((o) => o.status === 'READY' || (o.status === 'COMPLETED' && isToday(o.updatedAt))),
    },
  ]

  return (
    <>
      <h1 className="page-title">Mural de pedidos</h1>
      <p className="sub">Novos pedidos chegam automaticamente, com alerta visual e sonoro.</p>
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
          <span className="muted">Aguardando</span>
          <b>{waiting}</b>
        </div>
        <div className="stat sk sk-stat" style={{ '--i': 3 }}>
          <span className="muted">Estoque baixo</span>
          <b style={{ color: 'var(--red)' }}>{lowStock ?? '–'}</b>
        </div>
      </div>
      <div className="kanban">
        {columns.map((col) => (
          <section className="col" aria-label={col.label} key={col.key}>
            <h2>
              <span>
                <i className={`dot ${col.dot}`} />
                {col.title}
              </span>{' '}
              <span className={`tag ${col.tag}`}>{col.list.length}</span>
            </h2>
            {col.list.length === 0 && <p className="muted empty">Nenhum pedido aqui.</p>}
            {col.list.map((o, i) => <OrderCard key={o.id} order={o} index={i} />)}
          </section>
        ))}
      </div>
    </>
  )
}

function OrderCard({ order: o, index }) {
  const { advance, cancel } = useAdmin()
  const [busy, setBusy] = useState(false)
  const step = STEP[o.status]
  const { tone, label } = statusInfo(o.status)
  const fresh = o.status === 'PENDING' && Date.now() - new Date(o.createdAt).getTime() < 120_000
  const canAdvance = Boolean(ADVANCE_LABEL[o.status])
  const canCancel = o.status === 'PENDING' || o.status === 'IN_PREPARATION'

  const run = (action) => async () => {
    setBusy(true)
    await action(o)
    setBusy(false)
  }

  return (
    <article className={`order sk sk-order${fresh ? ' hot' : ''}`} style={{ '--i': index }}>
      <div className="row">
        <strong>#{orderCode(o.id)} · {customerName(o)}</strong>
        {o.status === 'READY' || o.status === 'COMPLETED' ? (
          <span className={`tag ${tone}`}>{label}</span>
        ) : (
          <span className="muted">{formatTime(o.createdAt)}</span>
        )}
      </div>
      <ul>
        {o.items.map((i) => <li key={i.productId}>{i.quantity}× {i.name}</li>)}
      </ul>
      {o.contact.deliveryMethod && <span className="muted">{o.contact.deliveryMethod}{o.contact.phone ? ` · ${o.contact.phone}` : ''}</span>}
      {o.contact.notes && <p className="muted" style={{ margin: '4px 0 0' }}>Obs.: {o.contact.notes}</p>}
      <div className="steps" aria-label={`Etapa ${step} de 4`}>
        {[1, 2, 3, 4].map((n) => <i key={n} className={n <= step ? 'on' : ''} />)}
      </div>
      <span className="steps-label">Etapa {step} de 4</span>
      <div className="row">
        <span className="muted">Total</span>
        <strong>{formatBRL(o.totalPrice)}</strong>
      </div>
      {(canAdvance || canCancel) && (
        <div className="actions">
          {canAdvance && (
            <button className="btn sm" type="button" disabled={busy} onClick={run(advance)}>
              {ADVANCE_LABEL[o.status]}
            </button>
          )}
          {canCancel && (
            <button className="btn danger sm" type="button" disabled={busy} onClick={run(cancel)}>
              Cancelar
            </button>
          )}
        </div>
      )}
    </article>
  )
}

export default Manager
