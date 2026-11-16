import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FlashAlerts from '../../components/FlashAlerts'
import MyOrders from '../../components/MyOrders'
import PushToggle from '../../components/PushToggle'
import { authErrorMessage, useAuth } from '../../context/AuthContext'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const prevent = (e) => e.preventDefault()

export default function Conta() {
  useDocumentTitle("Minha conta — VizinhoHub")
  const { user, displayName, logout, updateName } = useAuth()
  const navigate = useNavigate()
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
              <div className="panel">
                <h3>
                  Casa
                </h3>
                <p>
                  Rua das Flores, 120 — Aldeota
                  <br />
                  Fortaleza · CE · 60150-000
                </p>
                <span className="tag ok">
                  Principal
                </span>
                {' '}
                <a className="btn ghost sm" href="#" onClick={prevent}>
                  Editar
                </a>
              </div>
              <div className="panel">
                <h3>
                  Trabalho
                </h3>
                <p>
                  Av. Dom Luís, 500 — Meireles
                  <br />
                  Fortaleza · CE · 60160-230
                </p>
                <a className="btn ghost sm" href="#" onClick={prevent}>
                  Editar
                </a>
              </div>
            </div>
            <p>
              <a className="btn" href="#" onClick={prevent}>
                + Novo endereço
              </a>
            </p>
          </div>
          <div className="c4">
            <FlashAlerts />
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
