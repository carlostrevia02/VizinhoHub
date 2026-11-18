import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRecipes } from '../../lib/smartCart'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import '../../styles/smart-cart.css'

function Receitas() {
  useDocumentTitle('VizinhoHub Store — Receitas')
  const [q, setQ] = useState('')
  const [recipes, setRecipes] = useState(null) // null = carregando
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      listRecipes(q.trim() || undefined)
        .then((r) => alive && (setRecipes(r), setError(false)))
        .catch(() => alive && setError(true))
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])

  return (
    <main>
      <h1 className="page-title">Receitas</h1>
      <p className="sub">Escolha uma receita e a gente compara os preços das lojas do bairro para montar o carrinho mais barato.</p>
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="rq">Buscar receita</label>
        <input id="rq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: bolo, macarrão" />
      </div>

      {error ? (
        <p className="muted">Não foi possível carregar as receitas agora.</p>
      ) : recipes === null ? (
        <p className="muted">Carregando receitas…</p>
      ) : recipes.length === 0 ? (
        <p className="muted">Nenhuma receita encontrada.</p>
      ) : (
        <div className="sc-recipes">
          {recipes.map((r) => (
            <Link className="card" key={r.id} to={`/receitas/${r.slug}`}>
              <h3 style={{ margin: 0 }}>{r.title}</h3>
              <span className="muted">
                {r.servings} porções · {r.ingredientCount} ingredientes
              </span>
              <span className="btn sm" style={{ alignSelf: 'flex-start' }}>Ver receita</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}

export default Receitas
