import { useState } from 'react'
import { authErrorMessage, useAuth } from '../../context/AuthContext'
import PushToggle from '../../components/PushToggle'
import { audioUnlocked, unlockAudio } from '../../lib/alert'
import { autoPrintEnabled, printOrder, setAutoPrint } from '../../lib/print'
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
  const [autoPrint, setAutoPrintState] = useState(autoPrintEnabled)
  const [armed, setArmed] = useState(audioUnlocked())
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
            <div className="setting">
              <div>
                <strong>Som do caixa</strong>
                <small>O navegador só libera áudio depois de um clique. Ative no início do turno; o alarme toca até você atender.</small>
              </div>
              <button className="btn ghost" type="button" onClick={async () => { setArmed(await unlockAudio()); beep() }}>
                {armed ? 'Som ativo ✓' : 'Ativar som do caixa'}
              </button>
            </div>
            <div className="setting">
              <div>
                <strong>Avisos no celular (push)</strong>
                <small>Receba "novo pedido" mesmo com a aba fechada. No iPhone, instale o app na tela inicial.</small>
              </div>
              <PushToggle app="MERCHANT" label="Avisos de novo pedido no aparelho" />
            </div>
          </section>
          <section className="panel">
            <h3>Impressão da comanda</h3>
            <div className="setting">
              <div>
                <strong>Imprimir automaticamente neste computador</strong>
                <small>Papel térmico de 80 mm. Para não abrir o diálogo a cada pedido, abra o Chrome do caixa com <code>--kiosk-printing</code>.</small>
              </div>
              <label className="switch">
                <input type="checkbox" checked={autoPrint} onChange={(e) => { setAutoPrintState(e.target.checked); setAutoPrint(e.target.checked) }} aria-label="Imprimir comanda automaticamente" />
                <span />
              </label>
            </div>
            <p style={{ marginBottom: 0 }}>
              <button
                className="btn ghost"
                type="button"
                onClick={() =>
                  printOrder({
                    id: 'TESTE00000', createdAt: new Date().toISOString(), totalPrice: 12.5, channel: 'POS',
                    contact: { name: 'Teste de impressão', deliveryMethod: 'Retirada', paymentMethod: 'pix' },
                    items: [{ productId: 't', name: 'Item de teste', quantity: 2, unitPrice: 6.25 }],
                  })
                }
              >
                Imprimir página de teste
              </button>
            </p>
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
