import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { API_URL } from './api'

// Socket.io roda na mesma origem da API (a base /api/v1 não faz parte da URL do socket).
// API_URL pode ser relativa (/api/v1, mesma origem via nginx): nesse caso a base é a origem da página.
const SOCKET_URL = new URL(API_URL, window.location.origin).origin

/**
 * Escuta eventos do servidor enquanto `token` existir. `handlers` = { 'order:created': fn, ... };
 * a versão mais recente das funções é sempre usada, sem reconectar a cada render.
 */
export function useRealtime(token, handlers) {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    if (!token) return undefined
    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] })
    for (const event of Object.keys(latest.current)) {
      socket.on(event, (payload) => latest.current[event]?.(payload))
    }
    socket.on('connect_error', (err) => console.warn('Tempo real indisponível:', err.message))
    return () => {
      socket.close()
    }
  }, [token])
}

const SOUND_KEY = 'vizinhohub:sound'
// Preferência deste navegador (Configurações → Alerta sonoro). Ligado por padrão.
export function soundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}
export function setSoundEnabled(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    /* sem armazenamento: vale só até recarregar */
  }
}

// Bip curto de "novo pedido" (Web Audio, sem arquivo). Falha em silêncio se o navegador bloquear o áudio.
export function beep() {
  if (!soundEnabled()) return
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
    osc.onended = () => ctx.close()
  } catch {
    /* sem áudio */
  }
}
