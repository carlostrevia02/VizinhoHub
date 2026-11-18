import { api } from './api'

// Web Push (PWA). Funciona com o service worker registrado (produção) e HTTPS/localhost.
// No iPhone, só com o app instalado na tela inicial (iOS 16.4+).
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const b64ToBytes = (b64) => {
  const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** Pede permissão, assina e registra o aparelho na API. `app` = CUSTOMER | MERCHANT | COURIER. */
export async function enablePush(app) {
  if (!pushSupported()) throw new Error('Este navegador não suporta notificações push.')
  const reg = await navigator.serviceWorker.ready
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permissão de notificação negada.')
  const { publicKey } = await api.get('/push/key')
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }))
  await api.post('/push/subscribe', { ...sub.toJSON(), app })
  return sub
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  try {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint })
  } catch {}
  await sub.unsubscribe()
}
