import { useEffect, useState } from 'react'
import { ApiError } from '../lib/api'
import { LEDGER_LABEL, getCreditLedger, listMyCredit } from '../lib/caderneta'
import { formatBRL } from '../lib/format'
import '../styles/caderneta.css'

// Aba "Caderneta" da conta do cliente: uma conta por loja, com o limite, o que falta pagar e o extrato.
function MyCredit() {
  const [accounts, setAccounts] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null) // { id, entries }

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        setAccounts(await listMyCredit())
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Não foi possível carregar sua caderneta.')
      }
    }
    fetchAccounts()
  }, [])

  async function toggle(a) {
    if (open?.id === a.id) return setOpen(null)
    try {
      setOpen({ id: a.id, entries: (await getCreditLedger(a.id)).entries })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível abrir o extrato.')
    }
  }

  return (
    <div>
      <div className="panel">
        <h3>Caderneta</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          O fiado do bairro: a loja libera um limite e você acerta depois, direto com ela (Pix ou dinheiro). O pagamento é combinado com a loja, não pelo app.
        </p>
        {error && <p className="form-msg error" role="alert">{error}</p>}
        {accounts === null && !error && <p className="muted">Carregando…</p>}
        {accounts?.length === 0 && <p className="muted">Você ainda não tem caderneta em nenhuma loja. Peça ao lojista para abrir uma.</p>}
        {accounts?.map((a) => (
          <div key={a.id} className="panel" style={{ marginBottom: 12 }}>
            <div className="row">
              <strong>{a.merchant.name}</strong>
              {a.status !== 'ACTIVE' && <span className="tag off">{a.status === 'SUSPENDED' ? 'Suspensa' : 'Encerrada'}</span>}
            </div>
            <p style={{ margin: '6px 0' }}>
              Você deve <strong className={a.balance > 0 ? 'cad-owe' : 'cad-ok'}>{formatBRL(a.balance)}</strong> · limite {formatBRL(a.creditLimit)} ·
              disponível {formatBRL(a.available)}
              {a.settlementDay ? ` · acerto no dia ${a.settlementDay}` : ''}
            </p>
            <button className="btn ghost sm" type="button" onClick={() => toggle(a)}>{open?.id === a.id ? 'Ocultar extrato' : 'Ver extrato'}</button>
            {open?.id === a.id && (
              <div className="table-wrap cad-ledger" style={{ borderRadius: 'var(--radius)', marginTop: 10 }}>
                <table>
                  <thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th>Saldo</th></tr></thead>
                  <tbody>
                    {open.entries.map((l) => (
                      <tr key={l.id}>
                        <td>{new Date(l.createdAt).toLocaleDateString('pt-BR')}</td>
                        <td>{LEDGER_LABEL[l.kind]}{l.orderId ? ` · pedido #${l.orderId.slice(0, 6).toUpperCase()}` : ''}{l.note && l.kind !== 'CHARGE' ? ` · ${l.note}` : ''}</td>
                        <td className={l.amount < 0 ? 'neg' : 'pos'}>{formatBRL(l.amount)}</td>
                        <td>{formatBRL(l.balanceAfter)}</td>
                      </tr>
                    ))}
                    {open.entries.length === 0 && <tr><td colSpan={4} className="muted">Sem lançamentos.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default MyCredit
