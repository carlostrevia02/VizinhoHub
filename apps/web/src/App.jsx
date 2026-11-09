import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import AdminLayout from './components/AdminLayout'
import ProtectedRoute from './components/ProtectedRoute'
import StoreLayout from './components/StoreLayout'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import AdminProduto from './pages/admin/AdminProduto'
import Categorias from './pages/admin/Categorias'
import Clientes from './pages/admin/Clientes'
import Configuracoes from './pages/admin/Configuracoes'
import Dashboard from './pages/admin/Dashboard'
import Encartes from './pages/admin/Encartes'
import Estoque from './pages/admin/Estoque'
import Manager from './pages/admin/Manager'
import PedidoDetalhe from './pages/admin/PedidoDetalhe'
import Pedidos from './pages/admin/Pedidos'
import Relatorios from './pages/admin/Relatorios'
import Acompanhar from './pages/store/Acompanhar'
import Carrinho from './pages/store/Carrinho'
import Conta from './pages/store/Conta'
import Home from './pages/store/Home'
import Loja from './pages/store/Loja'
import Ofertas from './pages/store/Ofertas'
import OfertasBairro from './pages/store/OfertasBairro'
import Produto from './pages/store/Produto'
import Produtos from './pages/store/Produtos'

// Recharts pesa ~600 kB: só baixa quando o comerciante abre as Análises.
const AnalyticsPage = lazy(() => import('./pages/admin/analytics/AnalyticsPage'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Vitrine do cliente */}
      <Route element={<StoreLayout />}>
        <Route index element={<Home />} />
        <Route path="ofertas" element={<Ofertas />} />
        <Route path="ofertas-do-bairro" element={<OfertasBairro />} />
        <Route path="produtos" element={<Produtos />} />
        <Route path="produto/:id" element={<Produto />} />
        <Route path="carrinho" element={<Carrinho />} />
        <Route path="loja" element={<Loja />} />
        <Route element={<ProtectedRoute />}>
          <Route path="conta" element={<Conta />} />
          <Route path="acompanhar" element={<Acompanhar />} />
          <Route path="acompanhar/:id" element={<Acompanhar />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* Painel do comerciante */}
      <Route element={<ProtectedRoute merchant />}>
        <Route element={<AdminLayout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="dashboard/analytics" element={<Suspense fallback={<p className="muted">Carregando análises…</p>}><AnalyticsPage /></Suspense>} />
          <Route path="manager" element={<Manager />} />
          <Route path="pedidos" element={<Pedidos />} />
          <Route path="pedido-detalhe" element={<PedidoDetalhe />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="admin-produto" element={<AdminProduto />} />
          <Route path="categorias" element={<Categorias />} />
          <Route path="encartes" element={<Encartes />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="configuracoes" element={<Configuracoes />} />
        </Route>
      </Route>
    </Routes>
  )
}
