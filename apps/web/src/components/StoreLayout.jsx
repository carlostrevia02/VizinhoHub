import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import CartBar from './CartBar'
import { CartIcon, PinIcon, SearchIcon } from './Icons'

// Telas de compra mostram o endereço de entrega e o carrinho flutuante.
const SHOPPING = /^\/($|ofertas|produtos|produto\/)/

const navClass = ({ isActive }) => (isActive ? 'on' : undefined)

export default function StoreLayout() {
  const { pathname, hash } = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const { count } = useCart()
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState(params.get('q') ?? '')
  const shopping = SHOPPING.test(pathname)

  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0) // com #âncora, a própria página rola até a seção
  }, [pathname, hash])

  const submitSearch = (e) => {
    e.preventDefault()
    navigate(query.trim() ? `/produtos?q=${encodeURIComponent(query.trim())}` : '/produtos')
  }

  return (
    <>
      <header className="top light">
        <Link className="brand" to="/">
          <span className="logo">
            <CartIcon />
          </span>
          <span>
            VizinhoHub<small>Mercadinho do Zé · Aldeota</small>
          </span>
        </Link>
        <form className="search" role="search" onSubmit={submitSearch}>
          <input
            type="search"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busque por produtos, marcas e categorias"
            aria-label="Buscar produto"
          />
          <button className="btn" type="submit" aria-label="Buscar">
            <SearchIcon />
          </button>
        </form>

        <input
          type="checkbox"
          id="nav-toggle"
          className="nav-toggle"
          aria-label="Abrir menu"
          checked={menuOpen}
          onChange={(e) => setMenuOpen(e.target.checked)}
        />
        <label className="burger" htmlFor="nav-toggle" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </label>
        <nav className="nav" aria-label="Principal">
          <NavLink to="/" end className={navClass}>Início</NavLink>
          <NavLink to="/ofertas" className={navClass}>Ofertas</NavLink>
          <NavLink to="/radar" className={navClass}>Tá Quentinho</NavLink>
          <NavLink to="/clube" className={navClass}>Clube VIP</NavLink>
          <NavLink to="/ofertas-do-bairro" className={navClass}>Ofertas do bairro</NavLink>
          <NavLink to="/produtos" className={navClass}>Produtos</NavLink>
          <NavLink to="/carrinho" className={navClass}>
            Carrinho{count > 0 && <span className="cart-count">{count}</span>}
          </NavLink>
          {user ? (
            <NavLink to="/conta" className={navClass}>Minha conta</NavLink>
          ) : (
            <NavLink to="/login" className={navClass}>Entrar</NavLink>
          )}
        </nav>
      </header>

      {shopping && (
        <div className="delivery">
          <PinIcon /> Endereço de entrega: Rua das Flores, 120 — Aldeota, Fortaleza ·{' '}
          <Link to="/conta">Alterar</Link>
        </div>
      )}

      <Outlet />
      {shopping && <CartBar />}

      <footer className="footer">
        <b>VizinhoHub</b> · <Link to="/loja">Sobre a loja</Link> · <Link to="/conta">Minha conta</Link> · Projeto de
        extensão — Unifor
      </footer>
    </>
  )
}
