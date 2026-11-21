import { useCallback, useEffect, useState } from 'react'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import {
  LEDGER_LABEL,
  copyText,
  getCreditLedger,
  getCreditReminder,
  listCreditAccounts,
  listCreditCandidates,
  openCreditAccount,
  registerCreditAdjustment,
  registerCreditPayment,
  updateCreditAccount,
} from '../../lib/caderneta'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import '../../styles/caderneta.css'

const num = (s) => Number(String(s).replace(',', '.'))
const CAND_LIMIT = 50

// Caderneta (fiado): livro-razão do lojista. A plataforma NÃO recebe o dinheiro: você dá baixa à mão quando o
// cliente paga e o lembrete leva o "Pix copia e cola" da SUA chave (cadastrada em Configurações).
function Caderneta() {
  useDocumentTitle('Caderneta — VizinhoHub Manager')
  const { notify } = useAdmin()
  const [accounts, setAccounts] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [candSearch, setCandSearch] = useState('') // o que está digitado
  const [candTerm, setCandTerm] = useState('') // termo já enviado à API (com debounce)
  const [owingOnly, setOwingOnly] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState(null) // conta aberta no extrato
  const [ledger, setLedger] = useState([])
  const [open, setOpen] = useState({ customerId: '', creditLimit: '100' })
  const [pay, setPay] = useState({ amount: '', method: 'PIX', note: '' })
  const [adj, setAdj] = useState({ amount: '', note: '' })
  const [limit, setLimit] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setCandTerm(candSearch.trim()), 300)
    return () => clearTimeout(t)
  }, [candSearch])

  // Candidatos: até CAND_LIMIT por vez; para achar os demais, o lojista busca por nome ou e-mail.
  const loadCandidates = useCallback(async () => {
    try {
      setCandidates(await listCreditCandidates({ search: candTerm || undefined, limit: CAND_LIMIT }))
    } catch (err) {
      notify('Não foi possível buscar clientes', errorMessage(err), 'error')
    }
  }, [candTerm, notify])
  useEffect(() => {
    loadCandidates()
  }, [loadCandidates])

  const reload = useCallback(async () => {
    try {
      const acc = await listCreditAccounts({ owing: owingOnly ? 'true' : undefined })
      setAccounts(acc)
      setLoadError('')
      return acc
    } catch (err) {
      setLoadError(errorMessage(err))
      return null
    }
  }, [owingOnly])
  useEffect(() => {
    reload()
  }, [reload])

  const totalOwed = (accounts ?? []).reduce((s, a) => s + a.balance, 0)

  async function openLedger(account) {
    setSelected(account)
    setLimit(String(account.creditLimit))
    try {
      setLedger((await getCreditLedger(account.id)).entries)
    } catch (err) {
      notify('Não foi possível abrir o extrato', errorMessage(err), 'error')
    }
  }

  // Executa uma ação, avisa e recarrega a lista e o extrato aberto.
  async function run(action, okTitle, okSub = '', okTone = 'info') {
    setBusy(true)
    try {
      const result = await action()
      notify(okTitle, okSub, okTone)
      const [acc] = await Promise.all([reload(), loadCandidates()])
      const fresh = acc?.find((a) => a.id === selected?.id) ?? result
      if (fresh && selected) await openLedger(fresh)
      return true
    } catch (err) {
      notify('Não foi possível concluir', errorMessage(err), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const submitOpen = async (e) => {
    e.preventDefault()
    if (!open.customerId) return notify('Escolha o cliente', '', 'error')
    const ok = await run(() => openCreditAccount({ customerId: open.customerId, creditLimit: num(open.creditLimit) }), 'Caderneta aberta')
    if (ok) setOpen({ customerId: '', creditLimit: open.creditLimit })
  }

  const submitPay = async (e) => {
    e.preventDefault()
    const ok = await run(
      () => registerCreditPayment(selected.id, { amount: num(pay.amount), paymentMethod: pay.method.trim() || undefined, note: pay.note.trim() || undefined }),
      'Pagamento registrado',
    )
    if (ok) setPay({ amount: '', method: pay.method, note: '' })
  }

  // Aviso (não bloqueia): o ajuste positivo faria o saldo estourar o limite da conta.
  const adjOverLimit = () => selected && num(adj.amount) > 0 && selected.balance + num(adj.amount) > selected.creditLimit
  const submitAdj = async (e) => {
    e.preventDefault()
    const over = adjOverLimit()
    const ok = await run(
      () => registerCreditAdjustment(selected.id, { amount: num(adj.amount), note: adj.note.trim() }),
      over ? 'Ajuste lançado, conta acima do limite' : 'Ajuste lançado',
      over ? `O saldo passou do limite de ${formatBRL(selected.creditLimit)}.` : '',
      over ? 'error' : 'info',
    )
    if (ok) setAdj({ amount: '', note: '' })
  }

  const saveLimit = (e) => {
    e.preventDefault()
    return run(() => updateCreditAccount(selected.id, { creditLimit: num(limit) }), 'Limite atualizado')
  }

  async function remindWhatsApp(account) {
    try {
      const r = await getCreditReminder(account.id)
      window.open(r.whatsappUrl, '_blank', 'noopener')
      if (!r.pixCopyPaste) notify('Lembrete sem Pix', 'Cadastre sua chave Pix em Configurações para enviar o copia e cola.', 'info')
      reload()
    } catch (err) {
      notify('Não foi possível gerar o lembrete', errorMessage(err), 'error')
    }
  }

  async function copyPix(account) {
    try {
      const r = await getCreditReminder(account.id)
      if (!r.pixCopyPaste) return notify('Sem chave Pix', 'Cadastre sua chave Pix em Configurações.', 'error')
      notify((await copyText(r.pixCopyPaste)) ? 'Pix copia e cola copiado' : 'Não foi possível copiar', formatBRL(r.amount))
    } catch (err) {
      notify('Não foi possível gerar o Pix', errorMessage(err), 'error')
    }
  }

  return (
    <>
      <h1 className="page-title">Caderneta</h1>
      <p className="sub">
        Fiado do bairro. Você define o limite de cada cliente e dá baixa quando ele paga. A plataforma não recebe o dinheiro:
        só guarda o livro e ajuda a lembrar.
      </p>

      <section className="panel" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Abrir caderneta para um cliente</h3>
        {candidates.length === 0 && !candTerm ? (
          <p className="muted" style={{ margin: 0 }}>Clientes que já compraram na sua loja e ainda não têm caderneta aparecem aqui.</p>
        ) : (
          <form className="cad-inline" onSubmit={submitOpen}>
            <div className="field">
              <label htmlFor="cad-busca">Buscar cliente</label>
              <input id="cad-busca" type="search" autoComplete="off" placeholder="Nome ou e-mail" value={candSearch} onChange={(e) => setCandSearch(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cad-cli">Cliente</label>
              <select id="cad-cli" value={open.customerId} onChange={(e) => setOpen((o) => ({ ...o, customerId: e.target.value }))}>
                <option value="">{candidates.length === 0 ? 'Nenhum cliente encontrado' : 'Escolha…'}</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.orders} {c.orders === 1 ? 'pedido' : 'pedidos'}</option>)}
              </select>
              {candidates.length >= CAND_LIMIT && <span className="hint">Mostrando {CAND_LIMIT} clientes. Busque pelo nome ou e-mail para achar os demais.</span>}
            </div>
            <div className="field">
              <label htmlFor="cad-lim">Limite (R$)</label>
              <input id="cad-lim" inputMode="decimal" value={open.creditLimit} onChange={(e) => setOpen((o) => ({ ...o, creditLimit: e.target.value }))} />
            </div>
            <button className="btn" type="submit" disabled={busy}>Abrir caderneta</button>
          </form>
        )}
      </section>

      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>
          {owingOnly ? 'Quem está devendo' : 'Clientes da caderneta'} · <span className="cad-owe">{formatBRL(totalOwed)} em aberto</span>
        </h2>
        <label className="muted">
          <input type="checkbox" checked={owingOnly} onChange={(e) => setOwingOnly(e.target.checked)} /> só devedores
        </label>
      </div>

      {loadError ? (
        <p className="muted">{loadError} <button className="btn sm" type="button" onClick={reload}>Tentar de novo</button></p>
      ) : accounts === null ? (
        <p className="muted">Carregando…</p>
      ) : accounts.length === 0 ? (
        <p className="muted">Nenhuma caderneta {owingOnly ? 'com saldo em aberto' : 'aberta'} ainda.</p>
      ) : (
        <div className="table-wrap" style={{ borderRadius: 'var(--radius)' }}>
          <table>
            <thead>
              <tr><th>Cliente</th><th>Deve</th><th>Limite</th><th>Disponível</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.customer.name}
                    {a.status !== 'ACTIVE' && <> <span className="tag off">{a.status === 'SUSPENDED' ? 'Suspensa' : 'Encerrada'}</span></>}
                    <br /><span className="muted">{a.customer.phone ?? 'sem WhatsApp'}</span>
                  </td>
                  <td className={a.balance > 0 ? 'cad-owe' : 'cad-ok'}>{formatBRL(a.balance)}</td>
                  <td>{formatBRL(a.creditLimit)}</td>
                  <td>{formatBRL(a.available)}</td>
                  <td>
                    <div className="cad-actions">
                      <button className="btn ghost sm" type="button" onClick={() => openLedger(a)}>Extrato</button>
                      {a.balance > 0 && <button className="btn orange sm" type="button" onClick={() => remindWhatsApp(a)}>Lembrar no WhatsApp</button>}
                      {a.balance > 0 && <button className="btn ghost sm" type="button" onClick={() => copyPix(a)}>Copiar Pix</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <section className="panel" style={{ marginTop: 20 }} aria-label={`Extrato de ${selected.customer.name}`}>
          <div className="row">
            <h3 style={{ margin: 0 }}>Extrato · {selected.customer.name}</h3>
            <button className="btn ghost sm" type="button" onClick={() => setSelected(null)}>Fechar</button>
          </div>
          <p>
            Deve <strong className={selected.balance > 0 ? 'cad-owe' : 'cad-ok'}>{formatBRL(selected.balance)}</strong> de um limite de {formatBRL(selected.creditLimit)}.
          </p>

          <div className="two">
            <form onSubmit={submitPay}>
              <h4 style={{ margin: '0 0 6px' }}>Registrar pagamento (baixa)</h4>
              <div className="cad-inline">
                <div className="field"><label htmlFor="cp-v">Valor (R$)</label><input id="cp-v" inputMode="decimal" required value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} /></div>
                <div className="field"><label htmlFor="cp-m">Forma</label><input id="cp-m" maxLength={20} value={pay.method} onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))} /></div>
                <button className="btn" type="submit" disabled={busy || selected.balance <= 0}>Dar baixa</button>
              </div>
            </form>
            <form onSubmit={submitAdj}>
              <h4 style={{ margin: '0 0 6px' }}>Ajuste manual (com nota)</h4>
              <div className="cad-inline">
                <div className="field"><label htmlFor="ca-v">Valor (+ soma, − reduz)</label><input id="ca-v" inputMode="decimal" required placeholder="-5,00" value={adj.amount} onChange={(e) => setAdj((p) => ({ ...p, amount: e.target.value }))} /></div>
                <div className="field"><label htmlFor="ca-n">Motivo</label><input id="ca-n" required value={adj.note} onChange={(e) => setAdj((p) => ({ ...p, note: e.target.value }))} /></div>
                <button className="btn ghost" type="submit" disabled={busy}>Lançar</button>
              </div>
              {adjOverLimit() && <p className="muted cad-owe" role="status" style={{ margin: '6px 0 0' }}>Atenção: com este ajuste o saldo passa do limite ({formatBRL(selected.creditLimit)}). Você ainda pode lançar.</p>}
            </form>
          </div>

          <form className="cad-inline" style={{ margin: '14px 0' }} onSubmit={saveLimit}>
            <div className="field"><label htmlFor="cl-v">Limite (R$)</label><input id="cl-v" inputMode="decimal" required value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
            <button className="btn ghost" type="submit" disabled={busy}>Alterar limite</button>
          </form>

          <div className="table-wrap cad-ledger" style={{ borderRadius: 'var(--radius)' }}>
            <table>
              <thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th>Saldo</th><th>Observação</th></tr></thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{LEDGER_LABEL[l.kind]}{l.paymentMethod ? ` · ${l.paymentMethod}` : ''}</td>
                    <td className={l.amount < 0 ? 'neg' : 'pos'}>{formatBRL(l.amount)}</td>
                    <td>{formatBRL(l.balanceAfter)}</td>
                    <td>{l.note ?? (l.orderId ? `Pedido #${l.orderId.slice(0, 6).toUpperCase()}` : '')}</td>
                  </tr>
                ))}
                {ledger.length === 0 && <tr><td colSpan={5} className="muted">Sem lançamentos.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

export default Caderneta
