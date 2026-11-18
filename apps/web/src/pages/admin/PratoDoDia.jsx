import { useCallback, useEffect, useState } from 'react'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { listMyDailyMenu, setDailyMenu, updateDailyMenu } from '../../lib/caderneta'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import '../../styles/caderneta.css'

// Prato do dia: liga/desliga e porções do dia. Cada porção vendida sai do contador na hora; amanhã é outro dia (zera sozinho).
function PratoDoDia() {
  useDocumentTitle('Prato do dia — VizinhoHub Manager')
  const { notify, products, reloadProducts } = useAdmin()
  const [items, setItems] = useState(null)
  const [form, setForm] = useState({ productId: '', qty: '10' })
  const [error, setError] = useState('')
  const [qtyEdit, setQtyEdit] = useState({})

  const reload = useCallback(async () => {
    try {
      setItems(await listMyDailyMenu())
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const onMenu = new Set((items ?? []).map((i) => i.productId))
  const options = (products ?? []).filter((p) => p.active && p.kind !== 'COMBO' && !onMenu.has(p.id))

  async function add(e) {
    e.preventDefault()
    if (!form.productId) return setError('Escolha o prato.')
    setError('')
    try {
      await setDailyMenu({ productId: form.productId, qtyTotal: Number(form.qty), isOn: true })
      notify('Prato no cardápio de hoje', '')
      setForm({ productId: '', qty: form.qty })
      await Promise.all([reload(), reloadProducts?.()])
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function patch(item, body, title) {
    try {
      await updateDailyMenu(item.id, body)
      notify(title, item.productName)
      setQtyEdit((q) => ({ ...q, [item.id]: undefined }))
      await reload()
    } catch (err) {
      notify('Não foi possível atualizar', errorMessage(err), 'error')
    }
  }

  return (
    <>
      <h1 className="page-title">Prato do dia</h1>
      <p className="sub">
        Escolha o prato, defina quantas porções saem hoje e ligue. Quando as porções acabam ele some da vitrine; você pode desligar a qualquer
        momento. Ao colocar um produto aqui, ele passa a ser vendido pelas porções do dia (não pelo estoque).
      </p>
      <section className="panel" style={{ marginBottom: 20 }}>
        <form onSubmit={add} className="cad-inline">
          <div className="field">
            <label htmlFor="pd-p">Prato</label>
            <select id="pd-p" value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}>
              <option value="">{products === null ? 'Carregando…' : 'Escolha…'}</option>
              {options.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatBRL(p.price)}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="pd-q">Porções de hoje</label><input id="pd-q" type="number" min="0" required value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} /></div>
          <button className="btn" type="submit">Colocar no cardápio</button>
        </form>
        {error && <p className="deal-notice err" role="alert">{error}</p>}
      </section>

      <h2 style={{ fontSize: '1.1rem' }}>Cardápio de hoje</h2>
      {items === null ? <p className="muted">Carregando…</p> : items.length === 0 ? <p className="muted">Nenhum prato no cardápio de hoje.</p> : (
        <div className="table-wrap" style={{ borderRadius: 'var(--radius)' }}>
          <table>
            <thead><tr><th>Prato</th><th>Preço</th><th>Porções</th><th>No ar</th><th /></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.productName}</td>
                  <td>{formatBRL(i.price)}</td>
                  <td>
                    <strong>{i.qtyAvailable}</strong> de {i.qtyTotal}
                    {i.isOn && i.qtyAvailable === 0 && <> <span className="tag off">Esgotado</span></>}
                  </td>
                  <td>
                    <label className="switch">
                      <input type="checkbox" checked={i.isOn} aria-label={`Prato ${i.productName} ligado`} onChange={(e) => patch(i, { isOn: e.target.checked }, e.target.checked ? 'Prato ligado' : 'Prato desligado')} />
                      <span />
                    </label>
                  </td>
                  <td>
                    <div className="cad-actions">
                      <input type="number" min="0" aria-label="Novo total do dia" style={{ width: 80 }} value={qtyEdit[i.id] ?? i.qtyTotal} onChange={(e) => setQtyEdit((q) => ({ ...q, [i.id]: e.target.value }))} />
                      <button className="btn ghost sm" type="button" disabled={qtyEdit[i.id] === undefined || Number(qtyEdit[i.id]) === i.qtyTotal} onClick={() => patch(i, { qtyTotal: Number(qtyEdit[i.id]) }, 'Total do dia atualizado')}>Ajustar total</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export default PratoDoDia
