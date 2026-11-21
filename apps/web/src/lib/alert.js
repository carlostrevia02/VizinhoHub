import { useSyncExternalStore } from 'react'
import { SOUND_EVENT, soundEnabled } from './realtime'

// Alerta sonoro do caixa. Navegadores só liberam áudio depois de um gesto do usuário, então o painel
// precisa de um "Ativar som do caixa" no início do turno (unlockAudio). O alarme toca em loop até alguém atender.
let ctx = null
let timer = null
let wakeLock = null

// Estado do som compartilhado entre a faixa do painel e Configurações: quem mudar avisa os assinantes (hooks abaixo).
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

export function audioUnlocked() {
  return ctx?.state === 'running'
}

/** Chame dentro de um clique. Cria/retoma o contexto de áudio compartilhado e segura a tela acesa (quando suportado). */
export async function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!ctx) {
      ctx = new Ctx()
      ctx.onstatechange = emit
    }
    if (ctx.state === 'suspended') await ctx.resume()
  } catch {
    return false
  }
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
  } catch {
    wakeLock = null // sem permissão/suporte: o push cobre aba em segundo plano
  }
  emit()
  return audioUnlocked()
}

function subscribe(listener) {
  listeners.add(listener)
  window.addEventListener(SOUND_EVENT, listener)
  window.addEventListener('storage', listener) // outra aba mudou a preferência
  return () => {
    listeners.delete(listener)
    window.removeEventListener(SOUND_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

/** true depois que o som do caixa foi liberado (por qualquer botão "Ativar som do caixa"); re-renderiza ao mudar. */
export const useAudioArmed = () => useSyncExternalStore(subscribe, audioUnlocked, () => false)

/** Preferência "Alerta sonoro" (Configurações); re-renderiza ao ligar/desligar em qualquer lugar. */
export const useSoundEnabled = () => useSyncExternalStore(subscribe, soundEnabled, () => true)

function chime() {
  if (!ctx || ctx.state !== 'running') return
  const now = ctx.currentTime
  ;[880, 1175].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + i * 0.18)
    gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.18 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.3)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + i * 0.18)
    osc.stop(now + i * 0.18 + 0.32)
  })
}

/** Começa a tocar em loop (a cada 2,5 s) até stopAlarm(). Respeita a preferência "alerta sonoro". */
export function startAlarm() {
  if (timer || !soundEnabled()) return
  chime()
  timer = setInterval(chime, 2500)
}

export function stopAlarm() {
  clearInterval(timer)
  timer = null
}

export const alarmActive = () => timer !== null

export function releaseWakeLock() {
  const release = async () => {
    try {
      await wakeLock?.release?.()
    } catch {}
  }
  release()
  wakeLock = null
}
