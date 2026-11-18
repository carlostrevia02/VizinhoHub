import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PlanoOtimizado from '../../components/PlanoOtimizado'
import { useAuth } from '../../context/AuthContext'
import { ApiError } from '../../lib/api'
import { createListFromRecipe, errorText, formatQty, getRecipe, optimizeCart, usePlace } from '../../lib/smartCart'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import '../../styles/smart-cart.css'

function ReceitaDetalhe() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { place, fallback, locate } = usePlace()
  const [recipe, setRecipe] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [servings, setServings] = useState(4)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useDocumentTitle(recipe ? `VizinhoHub Store — ${recipe.title}` : 'VizinhoHub Store — Receita')

  useEffect(() => {
    let alive = true
    setRecipe(null)
    setNotFound(false)
    setResult(null)
    const fetchRecipe = async () => {
      try {
        const r = await getRecipe(slug)
        if (!alive) return
        setRecipe(r)
        setServings(r.servings)
      } catch (err) {
        if (alive) {
          if (err instanceof ApiError && err.status === 404) setNotFound(true)
          else setError(errorText(err, 'Não foi possível carregar a receita.'))
        }
      }
    }
    fetchRecipe()
    return () => {
      alive = false
    }
  }, [slug])

  const changeServings = (n) => {
    setServings(Math.max(1, Math.min(50, n)))
    setResult(null) // o plano era das porções anteriores
  }

  const compare = async () => {
    if (!place) return
    setBusy(true)
    setError('')
    try {
      setResult(await optimizeCart({ recipeSlug: slug, servings }, place))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const saveList = async () => {
    setBusy(true)
    setError('')
    try {
      await createListFromRecipe({ recipeSlug: slug, servings })
      navigate('/lista')
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  if (notFound) {
    return (
      <main>
        <h1 className="page-title">Receita não encontrada</h1>
        <Link className="btn" to="/receitas">Ver todas as receitas</Link>
      </main>
    )
  }
  if (!recipe) return <main>{error ? <p className="form-msg error" role="alert">{error}</p> : <p className="muted">Carregando receita…</p>}</main>

  const factor = servings / recipe.servings
  const needed = recipe.ingredients.filter((i) => !i.optional)
  const optional = recipe.ingredients.filter((i) => i.optional)

  return (
    <main>
      <p className="muted"><Link to="/receitas">← Receitas</Link></p>
      <h1 className="page-title">{recipe.title}</h1>
      <p className="sub">Ingredientes para {servings} {servings === 1 ? 'porção' : 'porções'}.</p>

      <div className="sc-actions">
        <span className="sc-servings">
          Porções:
          <button type="button" className="btn ghost sm" aria-label="Menos uma porção" onClick={() => changeServings(servings - 1)} disabled={servings <= 1}>−</button>
          <span aria-live="polite">{servings}</span>
          <button type="button" className="btn ghost sm" aria-label="Mais uma porção" onClick={() => changeServings(servings + 1)} disabled={servings >= 50}>+</button>
        </span>
      </div>

      <section className="panel" aria-label="Ingredientes">
        <ul className="sc-ingredients">
          {needed.map((i) => (
            <li key={i.canonicalId}>
              <span>{i.name}</span>
              <strong>{formatQty(i.quantity * factor)}</strong>
            </li>
          ))}
          {optional.map((i) => (
            <li key={i.canonicalId}>
              <span>{i.name} <span className="tag off">a gosto</span></span>
              <span className="muted">fora do cálculo</span>
            </li>
          ))}
        </ul>
      </section>

      {fallback && (
        <p className="deal-notice err" role="status" style={{ marginTop: 16 }}>
          Sem a sua localização, comparamos as lojas a partir do bairro da vitrine.{' '}
          <button className="btn sm" type="button" onClick={locate}>Tentar de novo</button>
        </p>
      )}
      <div className="sc-actions">
        <button className="btn orange" type="button" onClick={compare} disabled={busy || !place}>
          {busy ? 'Comparando preços…' : place ? 'Montar carrinho mais barato' : 'Descobrindo onde você está…'}
        </button>
        {user ? (
          <button className="btn ghost" type="button" onClick={saveList} disabled={busy}>Salvar como lista de compras</button>
        ) : (
          <Link className="btn ghost" to="/login" state={{ from: { pathname: `/receitas/${slug}` } }}>Entrar para salvar como lista</Link>
        )}
      </div>
      {error && <p className="form-msg error" role="alert">{error}</p>}

      {result && <PlanoOtimizado result={result} />}
    </main>
  )
}

export default ReceitaDetalhe
