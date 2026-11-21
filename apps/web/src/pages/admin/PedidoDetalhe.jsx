import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ADVANCE_LABEL, useAdmin } from '../../context/AdminContext'
import CancelOrderButton from '../../components/CancelOrderButton'
import { api } from '../../lib/api'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { PAYMENT_LABEL } from '../../lib/print'
import { customerName, formatWhen, hasDeliveryFlow, orderCode, statusInfo } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const STEPS = [
  { status: 'PENDING', title: 'Pendente', note: 'aguardando confirmação' },
  { status: 'IN_PREPARATION', title: 'Em preparação', note: 'pedido aceito, em separação' },
  { status: 'READY', title: 'Pronto', note: 'cliente avisado' },
  { status: 'COMPLETED', title: 'Entregue', note: 'pedido concluído' },
]
const FILL = ['12%', '38%', '64%', '100%']

function PedidoDetalhe() {
  const [params] = useSearchParams()
  const { orders, ordersError } = useAdmin()
  const id = params.get('id')
  const recent = orders?.find((o) => o.id === id)
  // Pedido antigo (fora da lista recente do painel, ex.: aberto pelo Histórico): busca direto na API.
  const [old, setOld] = useState(null) // { id, order } (order null = não encontrado)
  useEffect(() => {
    if (!orders || recent || !id) return undefined
    let cancelled = false
    const fetchOrder = async () => {
      try {
        const found = await api.get(`/orders/${id}`)
        if (!cancelled) setOld({ id, order: found })
      } catch {
        if (!cancelled) setOld({ id, order: null })
      }
    }
    fetchOrder()
    return () => {
      cancelled = true
    }
  }, [orders, recent, id])
  const fetched = old?.id === id ? old.order : null
  const order = recent ?? fetched
  useDocumentTitle(order ? `Pedido #${orderCode(order.id)} — VizinhoHub Manager` : 'Pedido — VizinhoHub Manager')

  if (ordersError) return <p className="muted">Não foi possível carregar o pedido.</p>
  if (!orders) return <p className="muted">Carregando pedido…</p>
  if (!order && id && old?.id !== id) return <p className="muted">Carregando pedido…</p>
  if (!order) {
    return (
      <>
        <h1 className="page-title">Pedido não encontrado</h1>
        <p className="sub">Esse pedido não existe ou não é desta loja.</p>
        <Link className="btn" to="/pedidos">Voltar aos pedidos</Link>
      </>
    )
  }
  return <Detalhe order={order} />
}

function Detalhe({ order: o }) {
  const { advance, cancel } = useAdmin()
  const [busy, setBusy] = useState(false)
  const { tone, label } = statusInfo(o.status)
  const cancelled = o.status === 'CANCELLED'
  const current = STEPS.findIndex((s) => s.status === o.status)
  const canAdvance = Boolean(ADVANCE_LABEL[o.status])
  const canCancel = o.status === 'PENDING' || o.status === 'IN_PREPARATION'
  // Entrega pelo fluxo de logística: quem conclui é o PIN do cliente na tela Entregas.
  const viaEntregas = o.status === 'READY' && hasDeliveryFlow(o)

  const run = (action) => async () => {
    setBusy(true)
    await action(o)
    setBusy(false)
  }

  const reprint = async () => {
    try {
      await api.post(`/print-jobs/orders/${o.id}/reprint`)
    } catch {
      window.print()
    }
  }

  return (
    <>
      <nav className="crumbs">
        <Link to="/pedidos">Pedidos</Link> › <span>#{orderCode(o.id)}</span>
      </nav>
      <div className="row" style={{ marginBottom: '14px' }}>
        <div>
          <h1 className="page-title">
            Pedido #{orderCode(o.id)}{' '}
            <span className={`tag ${tone}`} style={{ verticalAlign: 'middle' }}>{label}</span>
          </h1>
          <p className="sub" style={{ margin: 0 }}>
            Recebido em {formatWhen(o.createdAt)} · {o.channel === 'POS' ? 'Venda de balcão' : o.contact.deliveryMethod ?? 'Retirada na loja'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {canAdvance && !viaEntregas && <button className="btn" type="button" disabled={busy} onClick={run(advance)}>{ADVANCE_LABEL[o.status]}</button>}
          {viaEntregas && <Link className="btn" to="/entregas" title="A entrega é concluída com o PIN do cliente, na tela Entregas">Concluir em Entregas (PIN)</Link>}
          {!cancelled && <button className="btn ghost" type="button" onClick={reprint}>Imprimir comanda</button>}
          {canCancel && <CancelOrderButton label="Cancelar pedido" size="md" busy={busy} onConfirm={run(cancel)} />}
        </div>
      </div>
      <div className="grid-2">
        <section className="panel sk sk-lines">
          <h3>Itens do pedido</h3>
          <div className="table-wrap">
            <table className="spec">
              <thead>
                <tr>
                  <th style={{ width: 'auto' }}>Produto</th>
                  <th style={{ width: 'auto' }}>Qtd</th>
                  <th style={{ width: 'auto' }}>Unitário</th>
                  <th style={{ width: 'auto' }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i, n) => (
                  <tr key={i.productId} style={{ '--i': n }}>
                    <td>
                      <img className="pimg" src={imgSrc({})} alt="" width="76" height="76" loading="lazy" />
                      {i.name}
                    </td>
                    <td>{i.quantity}</td>
                    <td>{formatBRL(i.unitPrice)}</td>
                    <td>{formatBRL(i.quantity * i.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="summary-row" style={{ marginTop: '10px' }}>
            <strong>Total</strong>
            <strong>{formatBRL(o.totalPrice)}</strong>
          </div>
        </section>

        <section className="panel sk sk-lines" style={{ '--i': 1 }}>
          <h3>Andamento</h3>
          {cancelled ? (
            <p><span className="tag low">Cancelado</span> <span className="muted">em {formatWhen(o.updatedAt)}</span></p>
          ) : (
            <ol className="timeline">
              <span className="fill" style={{ '--h': FILL[current] }} />
              {STEPS.map((s, i) => (
                <li key={s.status} className={i < current || o.status === 'COMPLETED' ? 'done' : i === current ? 'now' : undefined}>
                  <span className="dot-s">{i < current || o.status === 'COMPLETED' ? '✓' : ''}</span>
                  <strong>{s.title}</strong>
                  <span className="muted">{i === current ? `${formatWhen(o.updatedAt)} — ${s.note}` : s.note}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <div className="two">
        <section className="panel">
          <h3>Cliente</h3>
          <dl className="kv">
            <dt>Nome</dt>
            <dd>{customerName(o)}</dd>
            <dt>WhatsApp</dt>
            <dd>{o.contact.phone ?? '—'}</dd>
            <dt>Entrega</dt>
            <dd>{o.contact.deliveryMethod ?? '—'}</dd>
            <dt>Endereço</dt>
            <dd>{o.contact.deliveryAddress ?? '—'}</dd>
            <dt>Observações</dt>
            <dd>{o.contact.notes ?? '—'}</dd>
          </dl>
        </section>
        <section className="panel">
          <h3>Resumo</h3>
          <dl className="kv">
            <dt>Origem</dt>
            <dd>{o.channel === 'POS' ? 'Balcão (PDV)' : 'Loja online'}</dd>
            <dt>Atualizado</dt>
            <dd>{formatWhen(o.updatedAt)}</dd>
            <dt>Pagamento</dt>
            <dd>{o.contact.paymentMethod ? PAYMENT_LABEL[o.contact.paymentMethod] ?? o.contact.paymentMethod : 'A combinar'}</dd>
            <dt>Valor</dt>
            <dd>{formatBRL(o.totalPrice)}</dd>
            {o.deliveryFee > 0 && (
              <>
                <dt>Taxa de entrega</dt>
                <dd>{formatBRL(o.deliveryFee)} (cobrada à parte)</dd>
              </>
            )}
            {o.vipSavings > 0 && (
              <>
                <dt>Desconto VIP</dt>
                <dd>{formatBRL(o.vipSavings)} (já abatido nos itens)</dd>
              </>
            )}
          </dl>
        </section>
      </div>
    </>
  )
}

export default PedidoDetalhe
