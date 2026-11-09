import { useEffect, useState } from 'react'
import { currentSubscription, disablePush, enablePush, pushSupported } from '../lib/push'

// Liga/desliga as notificações push deste aparelho. `app`: CUSTOMER (status do pedido) | MERCHANT (novo pedido).
export default function PushToggle({ app, label }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const supported = pushSupported()

  useEffect(() => {
    if (supported) currentSubscription().then((s) => setOn(Boolean(s))).catch(() => {})
  }, [supported])

  if (!supported) return <small className="muted">Este navegador não suporta notificações push.</small>

  const toggle = async (e) => {
    setBusy(true)
    setMsg('')
    try {
      if (e.target.checked) await enablePush(app)
      else await disablePush()
      setOn(e.target.checked)
    } catch (err) {
      setMsg(err.code === 'PUSH_NOT_CONFIGURED' ? 'As notificações ainda não foram configuradas no servidor.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <label className="switch">
        <input type="checkbox" checked={on} disabled={busy} onChange={toggle} aria-label={label} />
        <span />
      </label>
      {msg && <small className="form-msg error" role="status">{msg}</small>}
    </>
  )
}
