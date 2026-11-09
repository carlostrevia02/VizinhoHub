import { useState } from 'react'
import { authErrorMessage, useAuth } from '../../context/AuthContext'
import { beep, setSoundEnabled, soundEnabled } from '../../lib/realtime'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

export default function Configuracoes() {
  useDocumentTitle('Configurações — VizinhoHub Manager')
  const { user, updateMe } = useAuth()
  const store = user.store
  const [form, setForm] = useState({
    name: store?.name ?? '',
    neighborhood: store?.neighborhood ?? '',
    city: store?.city ?? '',
    state: store?.state ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [sound, setSound] = useState(soundEnabled)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await updateMe({
        store: {
          name: form.name.trim(),
          neighborhood: form.neighborhood.trim(),
          city: form.city.trim(),
          state: form.state.trim().toUpperCase(),
        },
      })
      setMsg({ text: 'Dados da loja salvos.' })
    } catch (err) {
      setMsg({ text: authErrorMessage(err), error: true })
    } finally {
      setBusy(false)
    }
  }

  const toggleSound = (e) => {
    setSound(e.target.checked)
    setSoundEnabled(e.target.checked)
    if (e.target.checked) beep() // prévia do som
  }

  return (
    <>
      <div className="row" style={{ marginBottom: '14px' }}>
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="sub" style={{ margin: 0 }}>Dados da loja e preferências do painel.</p>
        </div>
      </div>
      <div className="two">
        <section className="panel">
          <h3>Dados da loja</h3>
          <form onSubmit={save}>
            <div className="field">
              <label htmlFor="s1">Nome da loja</label>
              <input id="s1" required minLength={2} value={form.name} onChange={set('name')} />
            </div>
            <div className="field">
              <label htmlFor="s2">Bairro</label>
              <input id="s2" required minLength={2} value={form.neighborhood} onChange={set('neighborhood')} />
            </div>
            <div className="two">
              <div className="field">
                <label htmlFor="s3">Cidade</label>
                <input id="s3" required minLength={2} value={form.city} onChange={set('city')} />
              </div>
              <div className="field">
                <label htmlFor="s4">UF</label>
                <input id="s4" required minLength={2} maxLength={2} value={form.state} onChange={set('state')} placeholder="CE" />
              </div>
            </div>
            {msg && <p className={`form-msg ${msg.error ? 'error' : 'ok'}`} role="status">{msg.text}</p>}
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</button>
          </form>
        </section>

        <div style={{ display: 'grid', gap: '18px' }}>
          <section className="panel">
            <h3>Notificações</h3>
            <div className="setting">
              <div>
                <strong>Alerta sonoro de novo pedido</strong>
                <small>Toca no painel em tempo real (preferência deste navegador)</small>
              </div>
              <label className="switch">
                <input type="checkbox" checked={sound} onChange={toggleSound} aria-label="Alerta sonoro de novo pedido" />
                <span />
              </label>
            </div>
          </section>
          <section className="panel">
            <h3>Em breve</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              Horário de funcionamento, regras de entrega, formas de pagamento e mensagens automáticas no WhatsApp ainda não são
              salvos pela API.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
