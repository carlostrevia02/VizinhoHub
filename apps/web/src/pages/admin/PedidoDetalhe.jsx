import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ADVANCE_LABEL, useAdmin } from '../../context/AdminContext'
import { api } from '../../lib/api'
import { imgSrc } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { customerName, formatWhen, orderCode, statusInfo } from '../../lib/useOrders'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const STEPS = [
  { status: 'PENDING', title: 'Pendente', note: 'aguardando confirmação' },
  { status: 'IN_PREPARATION', title: 'Em preparação', note: 'baixa automática do estoque' },
  { status: 'READY', title: 'Pronto', note: 'cliente avisado' },
  { status: 'COMPLETED', title: 'Entregue', note: 'pedido concluído' },
]
const FILL = ['12%', '38%', '64%', '100%']

function PedidoDetalhe() {
  const [params] = useSearchParams()
  const { orders, ordersError } = useAdmin()
  const order = orders?.find((o) => o.id === params.get('id'))
  useDocumentTitle(order ? `Pedido #${orderCode(order.id)} — VizinhoHub Manager` : 'Pedido — VizinhoHub Manager')

  if (ordersError) return <p className="muted">Não foi possível carregar o pedido.</p>
  if (!orders) return <p className="muted">Carregando pedido…</p>
  if (!order) {
    return (
      <>
        <h1 className="page-title">Pedido não encontrado</h1>
        <p className="sub">Ele pode ser mais antigo que os 200 pedidos mais recentes.</p>
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

  const run = (action) => async () => {
    setBusy(true)
    await action(o)
    setBusy(false)
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
          {canAdvance && <button className="btn" type="button" disabled={busy} onClick={run(advance)}>{ADVANCE_LABEL[o.status]}</button>}
          <button className="btn ghost" type="button" onClick={() => api.post(`/print-jobs/orders/${o.id}/reprint`).catch(() => window.print())}>Imprimir comanda</button>
          {canCancel && <button className="btn danger" type="button" disabled={busy} onClick={run(cancel)}>Cancelar pedido</button>}
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
            <dt>Valor</dt>
            <dd>{formatBRL(o.totalPrice)}</dd>
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
