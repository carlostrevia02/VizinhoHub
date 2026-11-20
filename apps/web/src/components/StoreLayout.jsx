import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import CartBar from './CartBar'
import LocationButton from './LocationButton'
import { CartIcon, PinIcon, SearchIcon } from './Icons'

// Telas de compra mostram o endereço de entrega e o carrinho flutuante.
const SHOPPING = /^\/($|ofertas|produtos|produto\/)/

const navClass = ({ isActive }) => (isActive ? 'on' : undefined)
const withClass = (extra) => ({ isActive }) => (isActive ? `${extra} on` : extra)

function StoreLayout() {
  const { pathname, hash } = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const { count } = useCart()
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState(params.get('q') ?? '')
  const searchRef = useRef(null)
  const shopping = SHOPPING.test(pathname)
  const home = pathname === '/'

  // A vitrine pinta o <body>: cabeçalho, main e rodapé ficam como filhos diretos da página.
  useLayoutEffect(() => {
    document.body.classList.add('store')
    document.body.dataset.theme = 'mercado'
    return () => {
      document.body.classList.remove('store')
      delete document.body.dataset.theme
    }
  }, [])

  // O link "Ir para o conteúdo" leva o foco ao <main> da página atual.
  const skipToContent = (e) => {
    e.preventDefault()
    const main = document.getElementById('top')
    if (!main) return
    main.setAttribute('tabindex', '-1')
    main.focus()
    main.scrollIntoView()
  }

  useEffect(() => setMenuOpen(false), [pathname])
  // Cada tela da vitrine tem um <main>; ele é o destino do link de pular.
  useEffect(() => {
    const main = document.querySelector('main')
    if (main) main.id = 'top'
  }, [pathname])
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0) // com #âncora, a própria página rola até a seção
  }, [pathname, hash])

  // No celular a busca mora dentro do menu em tela cheia; o ícone da lupa abre o menu e leva o foco até ela.
  const openSearch = () => {
    setMenuOpen(true)
    requestAnimationFrame(() => searchRef.current?.focus())
  }

  const submitSearch = (e) => {
    e.preventDefault()
    navigate(query.trim() ? `/produtos?q=${encodeURIComponent(query.trim())}` : '/produtos')
  }

  return (
    <>
      <header className="store-nav" data-open={menuOpen}>
        <a className="skip-link" href="#top" onClick={skipToContent}>Ir para o conteúdo</a>
        <div className="wrap store-nav__bar">
          <Link className="store-brand" to="/">
            <span className="store-mark" aria-hidden="true">
              <CartIcon size={20} color="currentColor" />
            </span>
            <span className="store-brand__name">
              VizinhoHub
            </span>
          </Link>

          <form className="store-search" role="search" onSubmit={submitSearch}>
            <input
              ref={searchRef}
              type="search"
              name="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Busque por produtos, marcas e categorias"
              aria-label="Buscar produto"
            />
            <button type="submit" aria-label="Buscar">
              <SearchIcon />
            </button>
          </form>

          <nav className="store-links" id="store-menu" aria-label="Principal">
            <NavLink to="/produtos" className={navClass}>Produtos</NavLink>
            <div className="store-drop">
              <NavLink to="/ofertas" className={navClass}>Ofertas</NavLink>
              <div className="store-drop__panel">
                <NavLink to="/ofertas-do-bairro" className={navClass}>Ofertas do bairro</NavLink>
                <NavLink to="/radar" className={navClass}>Tá Quentinho</NavLink>
              </div>
            </div>
            <NavLink to="/receitas" className={navClass}>Receitas</NavLink>
            <NavLink to="/clube" className={navClass}>Clube VIP</NavLink>
            <NavLink to="/lista" className={withClass('store-links__extra')}>Minha lista</NavLink>
            {user ? (
              <NavLink to="/conta" className={withClass('store-links__account')}>Minha conta</NavLink>
            ) : (
              <NavLink to="/login" className={withClass('store-links__account')}>Entrar</NavLink>
            )}
          </nav>

          <button className="store-searchbtn" type="button" aria-label="Buscar produto" onClick={openSearch}>
            <SearchIcon color="currentColor" />
          </button>

          <Link className="store-cart" to="/carrinho" aria-label={count > 0 ? `Carrinho, ${count} ${count === 1 ? 'item' : 'itens'}` : 'Carrinho'}>
            <CartIcon size={20} color="currentColor" />
            <span className="store-cart__label">Carrinho</span>
            {count > 0 && <span className="cart-count">{count}</span>}
          </Link>

          <button
            className="store-burger"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="store-menu"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </header>

      {shopping && !home && (
        <div className="store-address">
          <div className="wrap">
            <PinIcon /> <LocationButton prefix="Entrega para " />
          </div>
        </div>
      )}

      <Outlet />
      {shopping && <CartBar />}

      <footer className="closing store-footer" style={{ '--h': 1 }}>
        <div className="wrap">
          <div className="store-footer__call">
            <div className="store-footer__close">
              <h2>Compre o que falta e receba em casa</h2>
              <p>Mercadinho do Zé, em Aldeota, com entrega no bairro.</p>
              <div className="btn-row">
                <Link className="btn btn--primary" to="/produtos">Começar minha compra</Link>
              </div>
            </div>
            <nav aria-label="Rodapé" className="store-footer__cols">
              <div>
                <h3>Comprar</h3>
                <Link to="/produtos">Todos os produtos</Link>
                <Link to="/ofertas">Ofertas da semana</Link>
                <Link to="/ofertas-do-bairro">Ofertas do bairro</Link>
                <Link to="/receitas">Receitas</Link>
              </div>
              <div>
                <h3>Minha área</h3>
                <Link to="/conta">Minha conta</Link>
                <Link to="/lista">Minha lista</Link>
                <Link to="/acompanhar">Acompanhar pedido</Link>
                <Link to="/clube">Clube VIP</Link>
              </div>
              <div>
                <h3>A loja</h3>
                <Link to="/loja">Sobre a loja</Link>
                <Link to="/entregador">Seja entregador</Link>
              </div>
            </nav>
          </div>
          <p className="store-footer__legal">© {new Date().getFullYear()} VizinhoHub · Projeto de extensão — Unifor</p>
        </div>
      </footer>
    </>
  )
}

export default StoreLayout
