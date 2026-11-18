import { Link } from 'react-router-dom'
import { useDocumentTitle } from '../lib/useDocumentTitle'

function NotFound() {
  useDocumentTitle('Página não encontrada — VizinhoHub')
  return (
    <main style={{ textAlign: 'center' }}>
      <h1 className="page-title">Página não encontrada</h1>
      <p className="sub">O endereço que você acessou não existe ou o produto saiu do catálogo.</p>
      <Link className="btn" to="/">Voltar para a vitrine</Link>
    </main>
  )
}

export default NotFound
