import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { ApiError } from '../../lib/api'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import {
  cancelVip,
  formatDate,
  formatDay,
  getVipMe,
  INVOICE_LABEL,
  listVipInvoices,
  listVipPlans,
  simulateVipPayment,
  SUBSCRIPTION_LABEL,
  subscribeVip,
} from '../../lib/vip'

const msg = (err) => (err instanceof ApiError ? err.message : 'Algo deu errado. Tente novamente.')

// Selo Vizinho VIP: assinatura mensal com desconto progressivo nas lojas que aderiram.
export default function Clube() {
  useDocumentTitle('VizinhoHub Store — Clube VIP')
  const { user } = useAuth()
  const [plans, setPlans] = useState(null)
  const [me, setMe] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [billingType, setBillingType] = useState('PIX')
  const [cpf, setCpf] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const isCustomer = user?.role === 'CUSTOMER'

  const reload = useCallback(async () => {
    try {
      setPlans(await listVipPlans())
      if (isCustomer) {
        setMe(await getVipMe())
        setInvoices(await listVipInvoices())
      }
    } catch (err) {
      setError(msg(err))
    }
  }, [isCustomer])
  useEffect(() => {
    reload()
  }, [reload])

  async function run(key, fn) {
    setBusy(key)
    setError('')
    try {
      await fn()
      await reload()
    } catch (err) {
      setError(msg(err))
    } finally {
      setBusy('')
    }
  }

  const sub = me?.subscription
  const live = sub && ['ACTIVE', 'PAST_DUE'].includes(sub.status)
  const [tone, label] = sub ? (SUBSCRIPTION_LABEL[sub.status] ?? ['off', sub.status]) : []

  return (
    <main>
      <h1 className="page-title">Clube Vizinho VIP</h1>
      <p className="sub">
        Assine, ganhe o selo e economize nas lojas do bairro que fazem parte do clube: o desconto cresce com o tempo de assinatura. O
        pagamento é feito direto no provedor (Pix ou cartão); o VizinhoHub não guarda o seu dinheiro.
      </p>

      {error && <p className="deal-notice err" role="alert">{error}</p>}

      {live && (
        <section className="panel" aria-label="Minha assinatura">
          <h2 style={{ marginTop: 0 }}>
            <span className="tag ok">VIP</span> Minha assinatura <span className={`tag ${tone}`}>{label}</span>
          </h2>
          {me.awaitingPayment ? (
            <p>Falta pagar a primeira fatura para liberar o desconto.</p>
          ) : sub.status === 'ACTIVE' ? (
            <p>
              Seu desconto hoje: <strong>{sub.discountPct}%</strong> nas lojas aderentes. Válida até <strong>{formatDate(sub.currentPeriodEnd)}</strong>
              {sub.cancelAtPeriodEnd ? ' — cancelamento agendado, não será renovada.' : '.'}
            </p>
          ) : (
            <p>Renovação em atraso: o desconto está suspenso até o pagamento da fatura.</p>
          )}
          {me.pendingInvoice && (
            <p>
              Fatura aberta de {formatBRL(me.pendingInvoice.amount)} (período {formatDay(me.pendingInvoice.periodStart)} a {formatDay(me.pendingInvoice.periodEnd)}).{' '}
              {me.paymentUrl && (
                <a className="btn sm" href={me.paymentUrl} target="_blank" rel="noreferrer">Pagar agora</a>
              )}{' '}
              {me.canSimulatePayment && (
                // Só aparece com o provedor mock fora de produção.
                <button className="btn sm" type="button" disabled={busy === 'pay'} onClick={() => run('pay', () => simulateVipPayment(me.pendingInvoice.id))}>
                  {busy === 'pay' ? 'Simulando…' : 'Simular pagamento (dev)'}
                </button>
              )}
            </p>
          )}
          {!sub.cancelAtPeriodEnd && (
            <button
              className="btn ghost sm"
              type="button"
              disabled={busy === 'cancel'}
              onClick={() => {
                if (window.confirm(sub.status === 'ACTIVE' ? 'Cancelar a assinatura? Você mantém o benefício até o fim do período pago.' : 'Cancelar a assinatura?')) {
                  run('cancel', () => cancelVip(true))
                }
              }}
            >
              {busy === 'cancel' ? 'Cancelando…' : 'Cancelar assinatura'}
            </button>
          )}
        </section>
      )}

      {!live && (
        <section style={{ marginTop: 16 }} aria-label="Planos">
          <h2>Planos</h2>
          {plans === null ? (
            <p className="muted">Carregando planos…</p>
          ) : (
            plans.map((p) => (
              <div className="panel" key={p.id} style={{ marginBottom: 12 }}>
                <h3 style={{ marginTop: 0 }}>{p.name} · {formatBRL(p.priceMonthly)}/mês</h3>
                <ul>
                  <li>Desconto progressivo: {p.tiers.map((t) => `${t.discountPct}% a partir do ${t.minMonths}º mês`).join(' · ')}</li>
                  {p.freeDelivery && <li>Frete grátis nas lojas aderentes{p.freeDeliveryMinOrder > 0 ? ` (pedidos a partir de ${formatBRL(p.freeDeliveryMinOrder)})` : ''}</li>}
                  <li>O desconto vale nas lojas com o selo VIP e não soma com ofertas relâmpago.</li>
                </ul>
                {isCustomer ? (
                  <>
                    <div className="grid-3">
                      <div className="field">
                        <label htmlFor="vip-bt">Forma de pagamento</label>
                        <select id="vip-bt" value={billingType} onChange={(e) => setBillingType(e.target.value)}>
                          <option value="PIX">Pix</option>
                          <option value="CREDIT_CARD">Cartão de crédito</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="vip-cpf">CPF ou CNPJ (só números)</label>
                        <input id="vip-cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value.replace(/\D/g, ''))} placeholder="Para emitir a cobrança" />
                      </div>
                    </div>
                    <button
                      className="btn"
                      type="button"
                      disabled={busy === 'sub'}
                      onClick={() => run('sub', () => subscribeVip({ planId: p.id, billingType, ...(cpf && { cpfCnpj: cpf }) }))}
                    >
                      {busy === 'sub' ? 'Assinando…' : `Assinar por ${formatBRL(p.priceMonthly)}/mês`}
                    </button>
                  </>
                ) : (
                  <p className="muted">
                    {user ? 'Só contas de cliente podem assinar.' : <><Link to="/login">Entre na sua conta</Link> para assinar.</>}
                  </p>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {isCustomer && invoices.length > 0 && (
        <section style={{ marginTop: 16 }} aria-label="Faturas">
          <h2>Faturas</h2>
          <div className="table-wrap" style={{ borderRadius: 'var(--radius)' }}>
            <table>
              <thead>
                <tr><th>Período</th><th>Valor</th><th>Status</th><th>Pago em</th></tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const [t, l] = INVOICE_LABEL[i.status] ?? ['off', i.status]
                  return (
                    <tr key={i.id}>
                      <td>{formatDay(i.periodStart)} a {formatDay(i.periodEnd)}</td>
                      <td>{formatBRL(i.amount)}</td>
                      <td><span className={`tag ${t}`}>{l}</span></td>
                      <td>{i.paidAt ? formatDate(i.paidAt) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}
