import { useCatalog } from '../context/CatalogContext'

// Mostra "carregando"/"erro" enquanto o catálogo da API não chega; com ele pronto, renderiza as páginas.
function CatalogStatus({ children }) {
  const { loading, error, reload } = useCatalog()

  if (loading) {
    return (
      <main>
        <p className="muted" style={{ padding: 24, textAlign: 'center' }}>Carregando produtos…</p>
      </main>
    )
  }
  if (error) {
    return (
      <main>
        <h1 className="page-title">Não foi possível carregar os produtos</h1>
        <p className="sub">Confira sua conexão e se o servidor está no ar.</p>
        <button className="btn" type="button" onClick={reload}>Tentar de novo</button>
      </main>
    )
  }
  return children
}

export default CatalogStatus
