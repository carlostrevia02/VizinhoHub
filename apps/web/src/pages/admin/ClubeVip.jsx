import { useCallback, useEffect, useState } from 'react'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { getVipMerchant, joinVipMerchant, leaveVipMerchant, updateVipMerchant } from '../../lib/vip'

// Clube VIP: a loja adere ao selo e define o teto de desconto que banca (a plataforma não subsidia).
function ClubeVip() {
  useDocumentTitle('Clube VIP — VizinhoHub Manager')
  const { notify } = useAdmin()
  const [state, setState] = useState(null) // null = carregando
  const [loadError, setLoadError] = useState('')
  const [cap, setCap] = useState('10')
  const [freeDelivery, setFreeDelivery] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = useCallback((s) => {
    setState(s)
    if (s.settings) {
      setCap(String(s.settings.discountCapPct).replace('.', ','))
      setFreeDelivery(s.settings.fundsFreeDelivery)
      setEnabled(s.settings.discountEnabled)
    }
  }, [])
  const reload = useCallback(async () => {
    try {
      apply(await getVipMerchant())
      setLoadError('')
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [apply])
  useEffect(() => {
    reload()
  }, [reload])

  const max = state?.maxCapPct ?? 30
  const capNumber = Number(String(cap).replace(',', '.'))
  const capProblem =
    String(cap).trim() === '' ? 'Informe o teto de desconto (digite 0 para não dar desconto).'
    : !Number.isFinite(capNumber) || !(capNumber >= 0 && capNumber <= max) ? `O teto deve ficar entre 0% e ${max}%.` : Math.abs(capNumber * 10 - Math.round(capNumber * 10)) > 1e-6 ? 'Use no máximo 1 casa decimal.' : ''

  async function save(join) {
    if (capProblem) return setError(capProblem)
    setError('')
    setBusy(true)
    try {
      const body = { discountEnabled: enabled, discountCapPct: capNumber, fundsFreeDelivery: freeDelivery }
      apply(await (join ? joinVipMerchant(body) : updateVipMerchant(body)))
      notify(join ? 'Loja no Clube VIP' : 'Clube VIP atualizado', 'Clientes com o selo já veem o benefício.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    if (!window.confirm('Sair do Clube VIP? Seus clientes VIP deixam de ter desconto na sua loja.')) return
    setBusy(true)
    try {
      await leaveVipMerchant()
      notify('Loja fora do Clube VIP', '')
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const enrolled = !!state?.enrolled
  return (
    <>
      <h1 className="page-title">Clube VIP</h1>
      <p className="sub">
        Aderindo, os clientes assinantes do Selo Vizinho VIP ganham desconto nos seus produtos. Quem banca o desconto é a sua loja, até o teto que
        você definir; a plataforma não subsidia. O desconto não se aplica a itens de oferta relâmpago.
      </p>

      {loadError ? (
        <p className="muted">
          {loadError} <button className="btn sm" type="button" onClick={reload}>Tentar de novo</button>
        </p>
      ) : state === null ? (
        <p className="muted">Carregando…</p>
      ) : (
        <>
          <section className="panel" style={{ marginBottom: 20 }}>
            <h2 style={{ marginTop: 0 }}>{enrolled ? 'Sua loja está no clube' : 'Aderir ao clube'}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                save(!enrolled)
              }}
              noValidate
            >
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="vip-cap">Teto de desconto que a loja banca (0 a {max}%)</label>
                  <input id="vip-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
                </div>
              </div>
              <p className="muted" style={{ marginTop: 0 }}>O cliente recebe o menor valor entre a faixa dele (por tempo de assinatura) e este teto.</p>
              <div className="field">
                <label>
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Conceder desconto VIP
                </label>
              </div>
              <div className="field">
                <label>
                  <input type="checkbox" checked={freeDelivery} onChange={(e) => setFreeDelivery(e.target.checked)} /> A loja banca o frete grátis dos assinantes
                </label>
              </div>
              {error && <p className="deal-notice err" role="alert">{error}</p>}
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Salvando…' : enrolled ? 'Salvar' : 'Aderir ao Clube VIP'}
              </button>{' '}
              {enrolled && <button className="btn ghost" type="button" disabled={busy} onClick={leave}>Sair do clube</button>}
            </form>
          </section>

          <h2 style={{ fontSize: '1.1rem' }}>Quanto os clientes VIP economizaram na sua loja</h2>
          <div className="grid-3">
            <div className="panel"><strong>{formatBRL(state.stats.totalSavings)}</strong><br /><span className="muted">economia total</span></div>
            <div className="panel"><strong>{state.stats.orders}</strong><br /><span className="muted">pedidos com desconto VIP</span></div>
            <div className="panel"><strong>{state.stats.customers}</strong><br /><span className="muted">clientes VIP atendidos</span></div>
          </div>
        </>
      )}
    </>
  )
}

export default ClubeVip
