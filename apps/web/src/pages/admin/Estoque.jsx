import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, useAdmin } from '../../context/AdminContext'
import { api } from '../../lib/api'
import { imgSrc, norm } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const PAGE_SIZE = 20
const LOW_STOCK = 5
const METER_MAX = 60 // estoque que enche a barra
const toNumber = (v) => Number(String(v).trim().replace(',', '.'))

function stockStatus(p) {
  if (p.stockQty === 0) return { tone: 'low', label: 'Esgotado' }
  if (p.stockQty <= LOW_STOCK) return { tone: 'low', label: 'Estoque baixo' }
  return { tone: 'ok', label: 'OK' }
}

function Estoque() {
  useDocumentTitle('VizinhoHub Manager — Estoque')
  const { products, productsError, reloadProducts, categories, notify } = useAdmin()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [filter, setFilter] = useState('all') // all | low | out
  const [page, setPage] = useState(1)
  const [drawer, setDrawer] = useState(false)

  const filtered = useMemo(() => {
    const q = norm(query.trim())
    return (products ?? []).filter((p) => {
      if (q && !norm(p.name).includes(q)) return false
      if (category && String(p.category.id) !== category) return false
      if (filter === 'low') return p.stockQty > 0 && p.stockQty <= LOW_STOCK
      if (filter === 'out') return p.stockQty === 0
      return true
    })
  }, [products, query, category, filter])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const onFilter = (setter) => (e) => {
    setter(e.target.value)
    setPage(1)
  }

  const act = async (fn, successTitle, p) => {
    try {
      await fn()
      await reloadProducts()
      if (successTitle) notify(successTitle, p.name)
    } catch (err) {
      notify(p.name, errorMessage(err), 'error')
    }
  }
  const adjust = (p, delta) => act(() => api.patch(`/products/${p.id}/stock`, { delta }), null, p)
  // A API faz exclusão lógica: o produto some da vitrine e do estoque (pedidos antigos continuam com o nome dele).
  const remove = (p) => {
    if (!window.confirm(`Remover "${p.name}" da vitrine e do estoque?`)) return
    act(() => api.delete(`/products/${p.id}`), 'Produto removido', p)
  }

  return (
    <>
      <div className="row" style={{ marginBottom: '6px' }}>
        <div>
          <h1 className="page-title">Gestão de estoque</h1>
          <p className="sub" style={{ margin: 0 }}>Cadastre produtos, ajuste quantidades e acompanhe alertas.</p>
        </div>
        <button className="btn" type="button" onClick={() => setDrawer(true)}>+ Cadastrar Novo Produto</button>
      </div>
      <p />

      <div className="toolbar-row">
        <input type="search" placeholder="Buscar produto" aria-label="Buscar produto" value={query} onChange={onFilter(setQuery)} />
        <select aria-label="Departamento" value={category} onChange={onFilter(setCategory)}>
          <option value="">Todos os departamentos</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Situação do estoque" value={filter} onChange={onFilter(setFilter)}>
          <option value="all">Todos</option>
          <option value="low">Estoque baixo</option>
          <option value="out">Esgotados</option>
        </select>
      </div>

      {productsError ? (
        <p className="muted">
          Não foi possível carregar os produtos. <button className="btn sm" type="button" onClick={reloadProducts}>Tentar de novo</button>
        </p>
      ) : !products ? (
        <p className="muted">Carregando produtos…</p>
      ) : (
        <div className="table-wrap sk sk-table" style={{ borderRadius: 'var(--radius)' }}>
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Departamento</th>
                <th>Preço</th>
                <th>Estoque</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan="6" className="empty">Nenhum produto encontrado.</td></tr>
              )}
              {rows.map((p, i) => {
                const { tone, label } = stockStatus(p)
                const low = p.stockQty <= LOW_STOCK
                return (
                  <tr key={p.id} style={{ '--i': i }}>
                    <td>
                      <img className="pimg" src={imgSrc({ img: p.image })} alt="" width="76" height="76" loading="lazy" />
                      {p.name}
                    </td>
                    <td>{p.category.name}</td>
                    <td>
                      {formatBRL(p.price)}
                      {p.unit === 'kg' ? '/kg' : ''}
                    </td>
                    <td>
                      {p.stockQty}
                      <span className="stock-adjust">
                        <button className="btn ghost sm" type="button" aria-label={`Tirar 1 de ${p.name}`} disabled={p.stockQty === 0} onClick={() => adjust(p, -1)}>−</button>
                        <button className="btn ghost sm" type="button" aria-label={`Adicionar 1 em ${p.name}`} onClick={() => adjust(p, 1)}>+</button>
                      </span>
                      <div className={`meter${low ? ' low' : ''}`} role="progressbar" aria-valuenow={p.stockQty} aria-valuemin="0" aria-valuemax={METER_MAX}>
                        <i style={{ '--v': Math.min(p.stockQty / METER_MAX, 1).toFixed(2) }} />
                      </div>
                    </td>
                    <td><span className={`tag ${tone}`}>{label}</span></td>
                    <td>
                      <div className="row-actions">
                        <Link className="btn ghost sm" to={`/admin-produto?id=${p.id}`}>Editar</Link>
                        <button className="btn ghost sm" type="button" onClick={() => remove(p)}>Remover</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="table-foot">
            <span className="muted">
              Mostrando {rows.length} de {filtered.length} {filtered.length === 1 ? 'produto' : 'produtos'}
            </span>
            {pages > 1 && (
              <span className="pager">
                <button className="btn ghost sm" type="button" disabled={current === 1} onClick={() => setPage(current - 1)} aria-label="Página anterior">‹</button>
                <span className="muted" style={{ padding: '0 8px' }}>{current} / {pages}</span>
                <button className="btn ghost sm" type="button" disabled={current === pages} onClick={() => setPage(current + 1)} aria-label="Próxima página">›</button>
              </span>
            )}
          </div>
        </div>
      )}

      <NewProductDrawer open={drawer} onClose={() => setDrawer(false)} />
    </>
  )
}

// Cadastro rápido (o formulário completo está em "Novo produto").
function NewProductDrawer({ open, onClose }) {
  const { categories, reloadProducts, notify } = useAdmin()
  const [form, setForm] = useState({ name: '', categoryId: '', price: '', stock: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const close = () => {
    setError('')
    onClose()
  }

  const submit = async (e) => {
    e.preventDefault()
    const price = toNumber(form.price)
    const stock = form.stock.trim() === '' ? 0 : toNumber(form.stock)
    if (!form.categoryId) return setError('Escolha o departamento.')
    if (!Number.isFinite(price) || form.price.trim() === '') return setError('Informe um preço válido (ex.: 4,29).')
    if (!Number.isInteger(stock) || stock < 0) return setError('O estoque precisa ser um número inteiro, 0 ou mais.')
    setBusy(true)
    setError('')
    try {
      await api.post('/products', { name: form.name.trim(), categoryId: Number(form.categoryId), price, stockQty: stock })
      await reloadProducts()
      notify('Produto cadastrado', form.name.trim())
      setForm({ name: '', categoryId: '', price: '', stock: '' })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input type="checkbox" id="drawer-toggle" className="drawer-toggle" aria-label="Abrir formulário de novo produto" checked={open} onChange={(e) => (e.target.checked ? undefined : close())} />
      <label className="scrim" htmlFor="drawer-toggle" aria-hidden="true" />
      <aside className="panel drawer" aria-label="Novo produto">
        <div className="drawer-head">
          <h2>Novo produto</h2>
          <label className="close" htmlFor="drawer-toggle" aria-label="Fechar">×</label>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="pn">Nome</label>
            <input id="pn" required minLength={2} placeholder="Ex.: Açúcar 1kg" value={form.name} onChange={set('name')} />
          </div>
          <div className="field">
            <label htmlFor="pc">Departamento</label>
            <select id="pc" required value={form.categoryId} onChange={set('categoryId')}>
              <option value="" disabled>Escolha…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pp">Preço (R$)</label>
            <input id="pp" required inputMode="decimal" placeholder="0,00" value={form.price} onChange={set('price')} />
          </div>
          <div className="field">
            <label htmlFor="ps">Quantidade em estoque</label>
            <input id="ps" inputMode="numeric" placeholder="0" value={form.stock} onChange={set('stock')} />
          </div>
          {error && <p className="form-msg error" role="alert">{error}</p>}
          <button className="btn block" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar produto'}</button>
          <p className="muted" style={{ textAlign: 'center' }}>
            Mais campos (validade, código de barras, B2B)? <Link to="/admin-produto" className="link-green">Cadastro completo</Link>
          </p>
        </form>
      </aside>
    </>
  )
}

export default Estoque
