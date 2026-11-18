import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Exige login; com `merchant`, exige também que a conta seja de comerciante.
function ProtectedRoute({ merchant = false }) {
  const { user, loading, isMerchant } = useAuth()
  const location = useLocation()

  if (loading) return <p className="muted" style={{ padding: 24, textAlign: 'center' }}>Carregando…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (merchant && !isMerchant) return <Navigate to="/" replace />
  return <Outlet />
}

export default ProtectedRoute
