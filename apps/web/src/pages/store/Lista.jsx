import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PlanoOtimizado from '../../components/PlanoOtimizado'
import {
  addListItem,
  createList,
  deleteList,
  errorText,
  formatQty,
  listLists,
  optimizeCart,
  removeListItem,
  renameList,
  searchCanonicals,
  usePlace,
} from '../../lib/smartCart'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import '../../styles/smart-cart.css'

function Lista() {
  useDocumentTitle('VizinhoHub Store — Minha lista')
  const { place, fallback, locate } = usePlace()
  const [lists, setLists] = useState(null) // null = carregando
  const [activeId, setActiveId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  // Adicionar item
  const [term, setTerm] = useState('')
  const [found, setFound] = useState([])
  const [qty, setQty] = useState(1)
  const [title, setTitle] = useState('')

  const reload = useCallback(async (keep) => {
    try {
      const l = await listLists()
      setLists(l)
      setActiveId((cur) => (keep ?? cur) && l.some((x) => x.id === (keep ?? cur)) ? (keep ?? cur) : (l[0]?.id ?? null))
    } catch (err) {
      setError(errorText(err, 'Não foi possível carregar suas listas.'))
      setLists([])
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  // Busca de item canônico enquanto digita.
  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) {
      setFound([])
      return undefined
    }
    let alive = true
    const fetchFound = async () => {
      try {
        const r = await searchCanonicals(q)
        if (alive) setFound(r)
      } catch {
        if (alive) setFound([])
      }
    }
    const t = setTimeout(fetchFound, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [term])

  const active = lists?.find((l) => l.id === activeId) ?? null

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const newList = (e) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    run(async () => {
      const created = await createList({ title: t, items: [] })
      setTitle('')
      setResult(null)
      await reload(created.id)
    })
  }

  const addItem = (item) =>
    run(async () => {
      const q = Number(qty) > 0 ? Number(qty) : 1
      await addListItem(active.id, { ...item, quantity: q })
      setTerm('')
      setFound([])
      setQty(1)
      setResult(null)
      await reload(active.id)
    })

  const addFreeText = () => {
    const text = term.trim()
    if (text) addItem({ freeText: text })
  }

  const removeItem = (itemId) =>
    run(async () => {
      await removeListItem(active.id, itemId)
      setResult(null)
      await reload(active.id)
    })

  const rename = () => {
    const t = window.prompt('Novo nome da lista', active.title)?.trim()
    if (t && t !== active.title) run(async () => (await renameList(active.id, t), reload(active.id)))
  }

  const remove = () => {
    if (!window.confirm(`Apagar a lista "${active.title}"?`)) return
    run(async () => {
      await deleteList(active.id)
      setResult(null)
      setActiveId(null)
      await reload()
    })
  }

  const compare = () =>
    run(async () => {
      setResult(await optimizeCart({ listId: active.id }, place))
    })

  const canonicalItems = active?.items.filter((i) => i.canonicalId != null) ?? []

  return (
    <main>
      <h1 className="page-title">Minha lista de compras</h1>
      <p className="sub">
        Monte a lista com itens de verdade (leite, arroz…) e a gente acha as lojas mais baratas do bairro. Quer ideias? Veja as{' '}
        <Link to="/receitas">receitas</Link>.
      </p>
      {error && <p className="form-msg error" role="alert">{error}</p>}

      {lists === null ? (
        <p className="muted">Carregando suas listas…</p>
      ) : (
        <div className="sc-lists">
          <aside className="panel" aria-label="Suas listas">
            <ul className="sc-listnav">
              {lists.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className={`btn sm ${l.id === activeId ? '' : 'ghost'}`}
                    aria-pressed={l.id === activeId}
                    onClick={() => (setActiveId(l.id), setResult(null))}
                  >
                    {l.title}
                  </button>
                </li>
              ))}
              {lists.length === 0 && <li className="muted">Você ainda não tem listas.</li>}
            </ul>
            <form onSubmit={newList}>
              <div className="field">
                <label htmlFor="nl">Nova lista</label>
                <input id="nl" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Ex.: Compras do mês" />
              </div>
              <button className="btn sm block" type="submit" disabled={busy || !title.trim()}>Criar lista</button>
            </form>
          </aside>

          <section className="panel" aria-label="Itens da lista">
            {!active ? (
              <p className="muted">Crie uma lista para começar.</p>
            ) : (
              <>
                <div className="sc-actions" style={{ marginTop: 0 }}>
                  <h2 style={{ margin: 0 }}>{active.title}</h2>
                  <button className="btn ghost sm" type="button" onClick={rename} disabled={busy}>Renomear</button>
                  <button className="btn ghost sm" type="button" onClick={remove} disabled={busy}>Apagar</button>
                </div>

                <div className="sc-search">
                  <input
                    aria-label="Buscar item ou digitar texto livre"
                    placeholder="Buscar item: leite, arroz, café…"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    style={{ flex: '1 1 200px', width: 'auto' }}
                  />
                  <input aria-label="Quantidade" type="number" min="1" max="99" value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
                {term.trim().length >= 2 && (
                  <div className="sc-results" aria-label="Resultados da busca">
                    {found.map((c) => (
                      <button key={c.id} type="button" className="btn ghost sm" disabled={busy} onClick={() => addItem({ canonicalId: c.id })}>
                        + {c.name}
                      </button>
                    ))}
                    <button type="button" className="btn ghost sm" disabled={busy} onClick={addFreeText}>
                      + "{term.trim()}" como texto livre
                    </button>
                  </div>
                )}

                {active.items.length === 0 ? (
                  <p className="muted">Lista vazia. Busque um item acima.</p>
                ) : (
                  <ul className="sc-lines" style={{ listStyle: 'none', padding: 0 }}>
                    {active.items.map((i) => (
                      <li className="sc-item" key={i.id}>
                        <span>
                          {formatQty(i.quantity)}× {i.canonicalName ?? i.freeText}
                          {i.canonicalId == null && <> <span className="tag off">texto livre</span></>}
                        </span>
                        <button type="button" className="btn ghost sm" aria-label={`Remover ${i.canonicalName ?? i.freeText}`} disabled={busy} onClick={() => removeItem(i.id)}>
                          Remover
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {fallback && (
                  <p className="deal-notice err" role="status">
                    Sem a sua localização, comparamos as lojas a partir do bairro da vitrine.{' '}
                    <button className="btn sm" type="button" onClick={locate}>Tentar de novo</button>
                  </p>
                )}
                <div className="sc-actions">
                  <button className="btn orange" type="button" onClick={compare} disabled={busy || !place || canonicalItems.length === 0}>
                    {busy ? 'Comparando preços…' : 'Otimizar: achar o menor preço'}
                  </button>
                  {canonicalItems.length === 0 && active.items.length > 0 && <span className="muted">Adicione ao menos um item da busca (texto livre não é comparado).</span>}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {result && <PlanoOtimizado result={result} />}
    </main>
  )
}

export default Lista
