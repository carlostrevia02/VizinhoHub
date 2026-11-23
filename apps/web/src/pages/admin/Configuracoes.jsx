import { useState } from 'react'
import { authErrorMessage, useAuth } from '../../context/AuthContext'
import PixKeyPanel from '../../components/PixKeyPanel'
import PushToggle from '../../components/PushToggle'
import StoreSettingsPanel from '../../components/StoreSettingsPanel'
import { unlockAudio, useAudioArmed, useSoundEnabled } from '../../lib/alert'
import { getPosition } from '../../lib/flash'
import { autoPrintEnabled, printOrder, setAutoPrint } from '../../lib/print'
import { beep, setSoundEnabled } from '../../lib/realtime'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

// Coordenadas digitadas: aceita vírgula decimal; o banco guarda NUMERIC(9,6), então arredonda em 6 casas.
const toCoord = (text) => {
  const t = String(text).trim().replace(',', '.')
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return NaN
  return Math.round(Number(t) * 1e6) / 1e6
}
const coordText = (n) => (n == null ? '' : String(n))

/** Valida o par latitude/longitude. Devolve { lat, lng } (ambos null = sem localização) ou { error }. */
function parseCoords(latText, lngText) {
  const empty = (s) => s.trim() === ''
  if (empty(latText) && empty(lngText)) return { lat: null, lng: null }
  if (empty(latText) || empty(lngText)) return { error: 'Preencha latitude e longitude juntas (ou deixe as duas em branco).' }
  const lat = toCoord(latText)
  const lng = toCoord(lngText)
  if (Number.isNaN(lat) || lat < -90 || lat > 90) return { error: 'Latitude inválida: use um número entre -90 e 90 (ex.: -3.7371).' }
  if (Number.isNaN(lng) || lng < -180 || lng > 180) return { error: 'Longitude inválida: use um número entre -180 e 180 (ex.: -38.496).' }
  return { lat, lng }
}

const geoErrorText = (err) =>
  err?.code === 1
    ? 'Permissão de localização negada. Libere no navegador ou digite as coordenadas.'
    : 'Não foi possível obter a localização agora. Tente de novo ou digite as coordenadas.'

function Configuracoes() {
  useDocumentTitle('Configurações — VizinhoHub Manager')
  const { user, updateMe } = useAuth()
  const store = user.store
  const [form, setForm] = useState({
    name: store?.name ?? '',
    neighborhood: store?.neighborhood ?? '',
    city: store?.city ?? '',
    state: store?.state ?? '',
    latitude: coordText(store?.latitude),
    longitude: coordText(store?.longitude),
  })
  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)
  const [msg, setMsg] = useState(null)
  const sound = useSoundEnabled() // acompanha a faixa do painel e outras abas
  const [autoPrint, setAutoPrintState] = useState(autoPrintEnabled)
  const armed = useAudioArmed() // vira "Som ativo ✓" também quando ativado pela faixa superior
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  // O aviso segue o que está salvo na loja (não o que está digitado): some assim que o salvamento der certo.
  const hasSavedCoords = store?.latitude != null && store?.longitude != null

  const useMyLocation = async () => {
    setLocating(true)
    setMsg(null)
    try {
      const p = await getPosition()
      setForm((f) => ({ ...f, latitude: p.lat.toFixed(6), longitude: p.lng.toFixed(6) }))
      setMsg({ text: 'Localização preenchida. Confira e clique em "Salvar alterações".' })
    } catch (err) {
      setMsg({ text: geoErrorText(err), error: true })
    } finally {
      setLocating(false)
    }
  }

  const save = async (e) => {
    e.preventDefault()
    const coords = parseCoords(form.latitude, form.longitude)
    if (coords.error) {
      setMsg({ text: coords.error, error: true })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await updateMe({
        store: {
          name: form.name.trim(),
          neighborhood: form.neighborhood.trim(),
          city: form.city.trim(),
          state: form.state.trim().toUpperCase(),
          latitude: coords.lat,
          longitude: coords.lng,
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
            <div className="two">
              <div className="field">
                <label htmlFor="s5">Latitude</label>
                <input id="s5" inputMode="decimal" autoComplete="off" value={form.latitude} onChange={set('latitude')} placeholder="-3.737100" />
              </div>
              <div className="field">
                <label htmlFor="s6">Longitude</label>
                <input id="s6" inputMode="decimal" autoComplete="off" value={form.longitude} onChange={set('longitude')} placeholder="-38.496000" />
              </div>
            </div>
            <p style={{ margin: '0 0 12px' }}>
              <button className="btn ghost" type="button" onClick={useMyLocation} disabled={locating}>
                {locating ? 'Localizando…' : 'Usar minha localização atual'}
              </button>
            </p>
            {!hasSavedCoords && (
              <p className="muted" role="note" style={{ margin: '0 0 12px', fontSize: '.85rem' }}>
                Sua loja ainda está sem localização. Enquanto não definir, ela não aparece no Radar (Tá Quentinho) nem permite
                calcular a entrega para os clientes.
              </p>
            )}
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
              <button className="btn ghost" type="button" onClick={async () => { await unlockAudio(); beep() }}>
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
          <PixKeyPanel />
          <StoreSettingsPanel />
        </div>
      </div>
    </>
  )
}

export default Configuracoes
