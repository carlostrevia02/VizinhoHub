import { Link } from 'react-router-dom'
import { useAdmin } from '../../context/AdminContext'
import { imgSrc, slugify } from '../../lib/catalog'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

// Os departamentos são os mesmos para todas as lojas (tabela `categories`); aqui o comerciante vê o quanto usa de cada um.
export default function Categorias() {
  useDocumentTitle('Departamentos — VizinhoHub Manager')
  const { categories, products, productsError, reloadProducts } = useAdmin()

  return (
    <>
      <div className="row" style={{ marginBottom: '14px' }}>
        <div>
          <h1 className="page-title">Departamentos</h1>
          <p className="sub" style={{ margin: 0 }}>Os departamentos da vitrine e quantos produtos da sua loja estão em cada um.</p>
        </div>
        <Link className="btn" to="/admin-produto">+ Novo produto</Link>
      </div>

      {productsError ? (
        <p className="muted">
          Não foi possível carregar os produtos. <button className="btn sm" type="button" onClick={reloadProducts}>Tentar de novo</button>
        </p>
      ) : !products ? (
        <p className="muted">Carregando departamentos…</p>
      ) : (
        <div className="grid-3">
          {categories.map((c) => {
            const mine = products.filter((p) => p.category.id === c.id)
            const active = mine.filter((p) => p.active)
            return (
              <section className="panel" key={c.id}>
                <div className="dept-card">
                  <img src={imgSrc({ img: mine.find((p) => p.image)?.image })} alt="" width="96" height="96" loading="lazy" />
                  <div style={{ flex: 1 }}>
                    <strong>{c.name}</strong>
                    <br />
                    <span className="muted">{mine.length} {mine.length === 1 ? 'produto' : 'produtos'}</span>
                  </div>
                  <span className={`tag ${active.length > 0 ? 'ok' : 'off'}`}>{active.length > 0 ? 'Ativo' : 'Vazio'}</span>
                </div>
                <p style={{ margin: '14px 0 0' }}>
                  <Link className="btn ghost sm" to="/estoque">Ver no estoque</Link>{' '}
                  <Link className="btn ghost sm" to={`/produtos#${slugify(c.name)}`}>Ver na vitrine</Link>
                </p>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
