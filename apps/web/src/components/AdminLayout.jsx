import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AdminProvider, useAdmin } from '../context/AdminContext'
import { useAuth } from '../context/AuthContext'
import { alarmActive, audioUnlocked, stopAlarm, unlockAudio } from '../lib/alert'
import { soundEnabled } from '../lib/realtime'
import { ClipboardIcon, sideIcons } from './Icons'

const MENU = [
  { title: 'Visão geral' },
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/dashboard/analytics', label: 'Análises', icon: 'chart' },
  { to: '/manager', label: 'Pedidos (Kanban)', icon: 'kanban', pill: true },
  { to: '/pedidos', label: 'Histórico de pedidos', icon: 'list' },
  { title: 'Catálogo' },
  { to: '/estoque', label: 'Estoque', icon: 'box' },
  { to: '/admin-produto', label: 'Novo produto', icon: 'plus' },
  { to: '/categorias', label: 'Departamentos', icon: 'grid' },
  { title: 'Ofertas' },
  { to: '/ofertas-relampago', label: 'Ofertas relâmpago', icon: 'plus' },
  { to: '/clube-vip', label: 'Clube VIP', icon: 'plus' },
  { to: '/encartes', label: 'Encartes dos mercados', icon: 'plus' },
  { title: 'Gestão' },
  { to: '/clientes', label: 'Clientes', icon: 'users' },
  { to: '/relatorios', label: 'Relatórios', icon: 'chart' },
  { to: '/configuracoes', label: 'Configurações', icon: 'gear' },
]

// Os dados do painel (pedidos em tempo real, produtos) vivem acima das páginas para não recarregar a cada troca de tela.
export default function AdminLayout() {
  return (
    <AdminProvider>
      <AdminShell />
    </AdminProvider>
  )
}

function AdminShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { activeOrders, toast, pendingCount } = useAdmin()
  const [armed, setArmed] = useState(audioUnlocked())
  const [, tick] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const waiting = activeOrders.filter((o) => o.status === 'PENDING').length

  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const signOut = async (e) => {
    e.preventDefault()
    await logout()
    navigate('/login')
  }

  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="logo">
            <ClipboardIcon />
          </span>
          <span>
            VizinhoHub Manager<small>{user.store?.name ?? user.name}</small>
          </span>
        </div>
        {pathname === '/manager' && <span className="badge">● Tempo real</span>}
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
          <Link to="/">Ver vitrine</Link>
          <Link to="/loja">Minha loja</Link>
          <a href="/login" onClick={signOut}>Sair</a>
        </nav>
      </header>
      <div className="admin">
        <aside className="side" aria-label="Menu do painel">
          {MENU.map((item) =>
            item.title ? (
              <h4 key={item.title}>{item.title}</h4>
            ) : (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'on' : undefined)}>
                {sideIcons[item.icon]}
                {item.label}
                {item.pill && waiting > 0 && <span className="pill">{waiting}</span>}
              </NavLink>
            ),
          )}
        </aside>
        <main>
          {soundEnabled() && !armed && (
            <div className="cashier-bar" role="region" aria-label="Som do caixa">
              <span>O navegador só toca o aviso de pedido depois de você ativar o som.</span>
              <button className="btn" type="button" onClick={async () => setArmed(await unlockAudio())}>Ativar som do caixa</button>
            </div>
          )}
          {pendingCount > 0 && alarmActive() && (
            <div className="cashier-bar alert" role="alert">
              <span>🔔 {pendingCount} {pendingCount === 1 ? 'pedido novo aguardando' : 'pedidos novos aguardando'}</span>
              <button className="btn" type="button" onClick={() => { stopAlarm(); tick((n) => n + 1); navigate('/manager') }}>Atender</button>
            </div>
          )}
          <Outlet />
        </main>
      </div>
      {toast && (
        // key reinicia a animação a cada aviso; os atrasos do CSS (feitos para a demo) são zerados aqui.
        <aside key={toast.id} className="toast" role="status" aria-live="polite" style={{ animationDelay: '0s', animationDuration: '6s' }}>
          <b>{toast.title}</b>
          <small style={toast.tone === 'error' ? { color: '#fecaca', opacity: 1 } : undefined}>{toast.sub}</small>
          <i style={{ animationDelay: '0s', animationDuration: '5.8s' }} />
        </aside>
      )}
    </>
  )
}
