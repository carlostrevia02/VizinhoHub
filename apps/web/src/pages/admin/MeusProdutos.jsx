import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdmin } from '../../context/AdminContext'
import { imgSrc, norm } from '../../lib/catalog'
import { formatBRL } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const PAGE_SIZE = 25

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// "2026-11-21" → "21/11/2026" (sem passar por Date, para não deslocar o dia pelo fuso).
const formatDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

function MeusProdutos() {
  useDocumentTitle('Meus produtos — VizinhoHub Manager')
  const { products, productsError, reloadProducts, categories } = useAdmin()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const q = norm(query.trim())
    return (products ?? []).filter((p) => {
      if (category !== 'all' && String(p.category.id) !== category) return false
      return !q || norm(p.name).includes(q)
    })
  }, [products, query, category])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const today = todayIso()
  const on = (setter) => (e) => {
    setter(e.target.value)
    setPage(1)
  }

  return (
    <>
      <div className="row" style={{ marginBottom: '14px' }}>
        <div>
          <h1 className="page-title">Meus produtos</h1>
          <p className="sub" style={{ margin: 0 }}>Encontre um produto da loja para editar preço, validade e dados.</p>
        </div>
        <Link className="btn" to="/admin-produto">Novo produto</Link>
      </div>

      <div className="toolbar-row">
        <input type="search" placeholder="Buscar produto pelo nome" aria-label="Buscar produto" value={query} onChange={on(setQuery)} />
        <select aria-label="Departamento" value={category} onChange={on(setCategory)}>
          <option value="all">Todos os departamentos</option>
          {categories.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
        <span className="muted" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'produto' : 'produtos'}</span>
      </div>

      {productsError ? (
        <p className="muted">
          Não foi possível carregar os produtos. <button className="btn sm" type="button" onClick={reloadProducts}>Tentar de novo</button>
        </p>
      ) : !products ? (
        <p className="muted">Carregando produtos…</p>
      ) : (
        <div className="products-list">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Imagem</th>
                  <th>Nome</th>
                  <th>Departamento</th>
                  <th>Preço</th>
                  <th>Validade</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan="6" className="empty">
                      {products.length === 0 ? 'Você ainda não cadastrou produtos.' : 'Nenhum produto encontrado.'}
                    </td>
                  </tr>
                )}
                {rows.map((p) => {
                  const expired = Boolean(p.expirationDate) && p.expirationDate.slice(0, 10) < today
                  const discounted = !expired && p.discountPct > 0
                  return (
                    <tr key={p.id}>
                      <td><img className="pimg" src={imgSrc({ img: p.image })} alt="" width="38" height="38" loading="lazy" /></td>
                      <td>
                        {p.name}
                        {!p.active && <> <span className="tag off">Inativo</span></>}
                      </td>
                      <td>{p.category.name}</td>
                      <td>
                        {discounted ? (
                          <>
                            <b>{formatBRL(p.effectivePrice)}</b> <s className="muted">{formatBRL(p.price)}</s>
                          </>
                        ) : (
                          formatBRL(p.price)
                        )}
                      </td>
                      <td>
                        {formatDate(p.expirationDate)}
                        {expired && <> <span className="tag low">Vencido</span></>}
                        {discounted && <> <span className="tag new">Salva-Estoque −{p.discountPct}%</span></>}
                      </td>
                      <td><Link className="btn ghost sm" to={`/admin-produto?id=${p.id}`}>Editar</Link></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span className="muted">Mostrando {rows.length} de {filtered.length} {filtered.length === 1 ? 'produto' : 'produtos'}</span>
            <span className="pager">
              <button className="btn ghost sm" type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Anterior</button>
              <span className="muted" style={{ padding: '0 8px', alignSelf: 'center' }}>página {current} de {pages}</span>
              <button className="btn ghost sm" type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>Próxima</button>
            </span>
          </div>
        </div>
      )}
    </>
  )
}

export default MeusProdutos
