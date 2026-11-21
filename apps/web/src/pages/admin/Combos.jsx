import { useCallback, useEffect, useState } from 'react'
import ProductPicker from '../../components/ProductPicker'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { createCombo, listMyCombos, removeCombo } from '../../lib/caderneta'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import '../../styles/caderneta.css'

const EMPTY = { name: '', description: '', categoryId: '', price: '', components: [{ componentId: '', quantity: '1' }, { componentId: '', quantity: '1' }] }

// Combos: um produto formado por outros.
function Combos() {
  useDocumentTitle('Combos — VizinhoHub Manager')
  const { notify, products, categories, reloadProducts } = useAdmin()
  const [combos, setCombos] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setCombos(await listMyCombos())
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const items = (products ?? []).filter((p) => p.active && p.kind === 'ITEM')
  const setComp = (idx, patch) => setForm((f) => ({ ...f, components: f.components.map((c, i) => (i === idx ? { ...c, ...patch } : c)) }))

  async function submit(e) {
    e.preventDefault()
    const comps = form.components.filter((c) => c.componentId)
    const price = Number(String(form.price).replace(',', '.'))
    if (comps.length < 2) return setError('Escolha pelo menos 2 produtos para o combo.')
    if (new Set(comps.map((c) => c.componentId)).size !== comps.length) return setError('Produto repetido no combo.')
    if (!(price >= 0) || !form.categoryId) return setError('Informe o preço e o departamento.')
    if (price > sum) return setError(`O combo não pode custar mais que a soma dos itens (${formatBRL(sum)}). Informe um preço de até ${formatBRL(sum)}.`)
    setBusy(true)
    setError('')
    try {
      await createCombo({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        categoryId: Number(form.categoryId),
        price,
        components: comps.map((c) => ({ componentId: c.componentId, quantity: Number(c.quantity) || 1 })),
      })
      notify('Combo criado', form.name)
      setForm(EMPTY)
      await Promise.all([reload(), reloadProducts?.()])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(c) {
    if (!window.confirm(`Remover o combo ${c.name}?`)) return
    try {
      await removeCombo(c.id)
      notify('Combo removido', c.name)
      await Promise.all([reload(), reloadProducts?.()])
    } catch (err) {
      notify('Não foi possível remover', errorMessage(err), 'error')
    }
  }

  const sum = form.components.reduce((s, c) => s + (items.find((p) => p.id === c.componentId)?.price ?? 0) * (Number(c.quantity) || 0), 0)

  return (
    <>
      <h1 className="page-title">Combos</h1>
      <p className="sub">Junte produtos num preço fechado.</p>
      <section className="panel" style={{ marginBottom: 20 }}>
        <form onSubmit={submit}>
          <div className="grid-3">
            <div className="field"><label htmlFor="cb-n">Nome do combo</label><input id="cb-n" required minLength={2} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="cb-c">Departamento</label>
              <select id="cb-c" required value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
                <option value="">Escolha…</option>
                {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="cb-p">Preço do combo (R$)</label><input id="cb-p" inputMode="decimal" required value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} /></div>
          </div>
          <div className="field"><label htmlFor="cb-d">Descrição</label><input id="cb-d" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <h4 style={{ margin: '4px 0' }}>Componentes</h4>
          {form.components.map((c, i) => (
            <div className="cad-inline" key={i} style={{ marginBottom: 6 }}>
              <div className="field">
                <ProductPicker
                  id={`cb-comp-${i}`}
                  ariaLabel={`Componente ${i + 1}`}
                  placeholder="Busque o produto…"
                  products={products === null ? null : items}
                  value={c.componentId}
                  onChange={(componentId) => setComp(i, { componentId })}
                  getHint={(p) => formatBRL(p.price)}
                />
              </div>
              <div className="field" style={{ flex: '0 0 90px' }}><input type="number" min="1" max="99" aria-label="Quantidade" value={c.quantity} onChange={(e) => setComp(i, { quantity: e.target.value })} /></div>
            </div>
          ))}
          <p>
            <button className="btn ghost sm" type="button" onClick={() => setForm((f) => ({ ...f, components: [...f.components, { componentId: '', quantity: '1' }] }))}>+ Componente</button>
            {sum > 0 && <span className="muted"> · Soma dos itens avulsos: {formatBRL(sum)}</span>}
          </p>
          {error && <p className="deal-notice err" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar combo'}</button>
        </form>
      </section>

      <h2 style={{ fontSize: '1.1rem' }}>Meus combos</h2>
      {combos === null ? <p className="muted">Carregando…</p> : combos.length === 0 ? <p className="muted">Nenhum combo ainda.</p> : (
        <div className="table-wrap" style={{ borderRadius: 'var(--radius)' }}>
          <table>
            <thead><tr><th>Combo</th><th>Preço</th><th>Componentes</th><th /></tr></thead>
            <tbody>
              {combos.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{formatBRL(c.price)}</td>
                  <td>{c.components.map((x) => `${x.quantity}× ${x.name}`).join(' + ')}</td>
                  <td><button className="btn ghost sm" type="button" onClick={() => remove(c)}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export default Combos
