import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ADVANCE_LABEL, useAdmin } from '../../context/AdminContext'
import CancelOrderButton from '../../components/CancelOrderButton'
import { formatBRL } from '../../lib/format'
import { customerName, formatTime, formatWhen, hasDeliveryFlow, isToday, orderCode, statusInfo } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const STEP = { PENDING: 1, IN_PREPARATION: 2, READY: 3, COMPLETED: 4 }

// Quem mudou de etapa há pouco aparece primeiro na coluna.
const byUpdated = (a, b) => b.updatedAt.localeCompare(a.updatedAt)
// Pedido de hoje mostra só a hora; de outro dia, dia/mês e hora.
const whenOf = (iso) => (isToday(iso) ? formatTime(iso) : formatWhen(iso))

function Manager() {
  useDocumentTitle('VizinhoHub Manager — Pedidos')
  const { orders, ordersError, reloadOrders, live } = useAdmin()
  // Só avisa que o tempo real caiu se a queda durar um pouco (a conexão leva um instante para abrir).
  const [down, setDown] = useState(false)
  useEffect(() => {
    if (live) {
      setDown(false)
      return undefined
    }
    const t = setTimeout(() => setDown(true), 2500)
    return () => clearTimeout(t)
  }, [live])

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

  const today = orders.filter((o) => isToday(o.createdAt) && o.status !== 'CANCELLED') // mesmo critério do Dashboard
  const revenue = today.reduce((s, o) => s + o.totalPrice, 0)
  const waiting = orders.filter((o) => o.status === 'PENDING').length

  const columns = [
    { key: 'new', title: 'Novos Pedidos', dot: 'y', tag: 'new', label: 'Novos pedidos', list: orders.filter((o) => o.status === 'PENDING').sort(byUpdated) },
    { key: 'prep', title: 'Em Preparação', dot: 'b', tag: 'prep', label: 'Em preparação', list: orders.filter((o) => o.status === 'IN_PREPARATION').sort(byUpdated) },
    {
      key: 'done',
      title: 'Prontos / Entregues',
      dot: 'g',
      tag: 'ok',
      label: 'Prontos e entregues',
      // Entregues só do dia, para o mural não crescer sem fim (o histórico está em "Pedidos").
      list: orders.filter((o) => o.status === 'READY' || (o.status === 'COMPLETED' && isToday(o.updatedAt))).sort(byUpdated),
    },
  ]

  return (
    <>
      <h1 className="page-title">Mural de pedidos</h1>
      <p className="sub">Novos pedidos chegam automaticamente, com alerta visual e sonoro.</p>
      {down && <p className="deal-notice err" role="status">Tempo real desconectado — tentando reconectar. Pedidos novos podem demorar a aparecer; ao voltar, a lista é recarregada.</p>}
      <div className="stats">
        <div className="stat sk sk-stat">
          <span className="muted">Pedidos hoje (sem cancelados)</span>
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
  // Entrega pelo fluxo de logística: quem conclui é o PIN do cliente na tela Entregas, não um clique aqui.
  const viaEntregas = o.status === 'READY' && hasDeliveryFlow(o)
  const meta = [o.status === 'READY' || o.status === 'COMPLETED' ? whenOf(o.createdAt) : null, o.contact.deliveryMethod, o.contact.phone].filter(Boolean)

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
          <span className="muted">{whenOf(o.createdAt)}</span>
        )}
      </div>
      <ul>
        {o.items.map((i) => <li key={i.productId}>{i.quantity}× {i.name}</li>)}
      </ul>
      {meta.length > 0 && <span className="muted">{meta.join(' · ')}</span>}
      {o.contact.deliveryAddress && <p className="muted" style={{ margin: '4px 0 0' }}>Entregar em: {o.contact.deliveryAddress}</p>}
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
        <div className="actions" style={{ flexWrap: 'wrap' }}>
          {canAdvance && !viaEntregas && (
            <button className="btn sm" type="button" disabled={busy} onClick={run(advance)}>
              {ADVANCE_LABEL[o.status]}
            </button>
          )}
          {viaEntregas && (
            <Link className="btn sm" to="/entregas" title="A entrega é concluída com o PIN do cliente, na tela Entregas">
              Concluir em Entregas (PIN)
            </Link>
          )}
          {canCancel && <CancelOrderButton busy={busy} onConfirm={run(cancel)} />}
        </div>
      )}
    </article>
  )
}

export default Manager
