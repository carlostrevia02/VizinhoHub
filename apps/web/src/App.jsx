import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import AdminLayout from './components/AdminLayout'
import ProtectedRoute from './components/ProtectedRoute'
import StoreLayout from './components/StoreLayout'
import Entregador from './pages/courier/Entregador'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import AdminProduto from './pages/admin/AdminProduto'
import Agenda from './pages/admin/Agenda'
import Caderneta from './pages/admin/Caderneta'
import Combos from './pages/admin/Combos'
import Clientes from './pages/admin/Clientes'
import ClubeVip from './pages/admin/ClubeVip'
import Configuracoes from './pages/admin/Configuracoes'
import Dashboard from './pages/admin/Dashboard'
import Entregas from './pages/admin/Entregas'
import Manager from './pages/admin/Manager'
import MeusProdutos from './pages/admin/MeusProdutos'
import PedidoDetalhe from './pages/admin/PedidoDetalhe'
import OfertasRelampago from './pages/admin/OfertasRelampago'
import PratoDoDia from './pages/admin/PratoDoDia'
import Pedidos from './pages/admin/Pedidos'
import Relatorios from './pages/admin/Relatorios'
import Acompanhar from './pages/store/Acompanhar'
import Carrinho from './pages/store/Carrinho'
import Clube from './pages/store/Clube'
import Conta from './pages/store/Conta'
import Home from './pages/store/Home'
import Loja from './pages/store/Loja'
import Ofertas from './pages/store/Ofertas'
import OfertasBairro from './pages/store/OfertasBairro'
import Produto from './pages/store/Produto'
import Produtos from './pages/store/Produtos'
import Radar from './pages/store/Radar'
import ReceitaDetalhe from './pages/store/ReceitaDetalhe'
import Receitas from './pages/store/Receitas'
import Lista from './pages/store/Lista'

// Recharts pesa ~600 kB: só baixa quando o comerciante abre as Análises.
const AnalyticsPage = lazy(() => import('./pages/admin/analytics/AnalyticsPage'))

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Vitrine do cliente */}
      <Route element={<StoreLayout />}>
        <Route index element={<Home />} />
        <Route path="ofertas" element={<Ofertas />} />
        <Route path="ofertas-do-bairro" element={<OfertasBairro />} />
        <Route path="radar" element={<Radar />} />
        <Route path="clube" element={<Clube />} />
        <Route path="receitas" element={<Receitas />} />
        <Route path="receitas/:slug" element={<ReceitaDetalhe />} />
        <Route path="produtos" element={<Produtos />} />
        <Route path="produto/:id" element={<Produto />} />
        <Route path="carrinho" element={<Carrinho />} />
        <Route path="loja" element={<Loja />} />
        <Route element={<ProtectedRoute />}>
          <Route path="lista" element={<Lista />} />
          <Route path="conta" element={<Conta />} />
          <Route path="acompanhar" element={<Acompanhar />} />
          <Route path="acompanhar/:id" element={<Acompanhar />} />
          <Route path="entregador" element={<Entregador />} />
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
          <Route path="entregas" element={<Entregas />} />
          <Route path="pedido-detalhe" element={<PedidoDetalhe />} />
          <Route path="meus-produtos" element={<MeusProdutos />} />
          <Route path="admin-produto" element={<AdminProduto />} />
          <Route path="ofertas-relampago" element={<OfertasRelampago />} />
          <Route path="clube-vip" element={<ClubeVip />} />
          <Route path="caderneta" element={<Caderneta />} />
          <Route path="agenda" element={<Agenda />} />
          <Route path="prato-do-dia" element={<PratoDoDia />} />
          <Route path="combos" element={<Combos />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="configuracoes" element={<Configuracoes />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
