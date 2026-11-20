import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FlashAlerts from '../../components/FlashAlerts'
import MyOrders from '../../components/MyOrders'
import MyCredit from '../../components/MyCredit'
import PushToggle from '../../components/PushToggle'
import { authErrorMessage, useAuth } from '../../context/AuthContext'
import { addressLine1, addressLine2, useAddresses } from '../../lib/addresses'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

// Diálogo com mapa (Leaflet/Google) carregado só quando alguém abre um endereço.
const AddressDialog = lazy(() => import('../../components/AddressDialog'))

function Conta() {
  useDocumentTitle("Minha conta — VizinhoHub")
  const { user, displayName, logout, updateName } = useAuth()
  const navigate = useNavigate()
  const addresses = useAddresses(user.id)
  const [editing, setEditing] = useState(null) // null | {} (novo) | endereço existente
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const saveName = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      await updateName(name.trim())
      setMsg({ text: 'Dados atualizados.' })
    } catch (err) {
      setMsg({ text: authErrorMessage(err), error: true })
    } finally {
      setSaving(false)
    }
  }
  const signOut = async () => {
    await logout()
    navigate('/login')
  }
  return (
    <main>
      <h1 className="page-title">
        Minha conta
      </h1>
      <p className="sub">
        Acompanhe seus pedidos e mantenha seus dados atualizados.
      </p>
      <div className="account">
        <input type="radio" name="acc" id="a1" defaultChecked />
        <input type="radio" name="acc" id="a2" />
        <input type="radio" name="acc" id="a3" />
        <input type="radio" name="acc" id="a4" />
        <input type="radio" name="acc" id="a5" />
        <div className="menu">
          <div className="profile">
            <span className="avatar">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>
                {displayName}
              </strong>
              <br />
              <span className="muted">
                {user.email}
              </span>
            </div>
          </div>
          <label htmlFor="a1">
            Meus pedidos
          </label>
          <label htmlFor="a2">
            Endereços
          </label>
          <label htmlFor="a3">
            Meus dados
          </label>
          <label htmlFor="a4">
            Alertas perto de casa
          </label>
          <label htmlFor="a5">
            Caderneta
          </label>
          <button type="button" className="btn ghost sm" style={{ marginTop: "8px" }} onClick={signOut}>
            Sair da conta
          </button>
        </div>
        <div className="content">
          <div className="c1">
            <MyOrders />
          </div>
          <div className="c2">
            <div className="two">
              {addresses.list.map((a) => (
                <div className="panel" key={a.id}>
                  <h3>
                    {a.label}
                  </h3>
                  <p>
                    {addressLine1(a)}
                    <br />
                    {addressLine2(a)}
                  </p>
                  {a.primary && (
                    <>
                      <span className="tag ok">
                        Principal
                      </span>
                      {' '}
                    </>
                  )}
                  <button type="button" className="btn ghost sm" onClick={() => setEditing(a)}>
                    Editar
                  </button>
                </div>
              ))}
            </div>
            <p>
              <button type="button" className="btn" onClick={() => setEditing({})}>
                + Novo endereço
              </button>
            </p>
            {editing && (
              <Suspense fallback={null}>
                <AddressDialog
                  address={editing}
                  canRemove={addresses.list.length > 1}
                  onClose={() => setEditing(null)}
                  onSave={(a) => {
                    addresses.save(a)
                    setEditing(null)
                  }}
                  onRemove={(id) => {
                    addresses.remove(id)
                    setEditing(null)
                  }}
                />
              </Suspense>
            )}
          </div>
          <div className="c4">
            <FlashAlerts />
          </div>
          <div className="c5">
            <MyCredit />
          </div>
          <div className="c3">
            <div className="panel">
              <h3>Avisos do pedido</h3>
              <div className="setting">
                <div>
                  <strong>Notificações no aparelho</strong>
                  <small>Avisamos quando a loja aceitar e quando o pedido estiver pronto.</small>
                </div>
                <PushToggle app="CUSTOMER" label="Avisos do pedido neste aparelho" />
              </div>
            </div>
            <div className="panel">
              <h3>
                Dados pessoais
              </h3>
              <form onSubmit={saveName}>
                <div className="field">
                  <label htmlFor="cn">
                    Nome completo
                  </label>
                  <input id="cn" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="ce">
                    E-mail
                  </label>
                  <input id="ce" defaultValue={user.email} readOnly />
                </div>
                {msg && <p className={`form-msg ${msg.error ? 'error' : ''}`} role="status">{msg.text}</p>}
                <button className="btn" type="submit" disabled={saving || !name.trim() || name.trim() === user.name}>
                  {saving ? 'Salvando…' : 'Salvar alterações'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

export default Conta
