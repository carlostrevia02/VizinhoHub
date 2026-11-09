import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { api, setApiToken, setUnauthorizedHandler } from '../lib/api'
import { auth, firebaseConfigured } from '../lib/firebase'

const AuthContext = createContext(null)
const TOKEN_KEY = 'vizinhohub:token'

// O token da API fica no localStorage só para sobreviver ao reload de sessões sem Firebase.
const storage = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set: (t) => {
    try {
      t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* armazenamento indisponível: a sessão vale só até recarregar */
    }
  },
}

const requireAuth = () => {
  if (!auth) throw new Error('firebase-not-configured')
  return auth
}

// Falhas em que vale tentar o login próprio da API (a conta pode não existir no Firebase).
const FIREBASE_MISSING_ACCOUNT = ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-login-credentials']

export function AuthProvider({ children }) {
  // `user` é o UserDTO da API: { id, name, email, role, store }. O papel vem sempre do banco.
  const [user, setUser] = useState(null)
  // Enquanto não sabemos quem é o usuário (e o papel dele), não decidimos nenhum redirecionamento.
  const [loading, setLoading] = useState(true)
  // Token da API em estado para o tempo real (socket) reconectar quando a sessão muda.
  const [token, setToken] = useState(null)

  const startSession = useCallback((result) => {
    setApiToken(result.token)
    setToken(result.token)
    storage.set(result.token)
    setUser(result.user)
    return result.user
  }, [])

  const endSession = useCallback(() => {
    setApiToken(null)
    setToken(null)
    storage.set(null)
    setUser(null)
  }, [])

  // ID token do Firebase → token da API (cria o cliente no 1º acesso).
  const exchange = useCallback(async (fbUser, name) => {
    const idToken = await fbUser.getIdToken()
    return startSession(await api.post('/auth/firebase', { idToken, ...(name && { name }) }))
  }, [startSession])

  const restoreStoredSession = useCallback(async () => {
    const stored = storage.get()
    if (!stored) return
    setApiToken(stored)
    try {
      setUser(await api.get('/auth/me'))
      setToken(stored)
    } catch {
      endSession()
    }
  }, [endSession])

  useEffect(() => {
    setUnauthorizedHandler(endSession)
  }, [endSession])

  useEffect(() => {
    if (!auth) {
      restoreStoredSession().finally(() => setLoading(false))
      return undefined
    }
    return onAuthStateChanged(auth, async (fbUser) => {
      try {
        if (fbUser) await exchange(fbUser)
        else await restoreStoredSession()
      } catch (err) {
        console.error('Não foi possível iniciar a sessão na API:', err)
        endSession()
      } finally {
        setLoading(false)
      }
    })
  }, [exchange, restoreStoredSession, endSession])

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      isMerchant: user?.role === 'MERCHANT',
      displayName: user?.name || user?.email?.split('@')[0] || '',
      firebaseConfigured,

      login: async (email, password) => {
        let firebaseError
        if (auth) {
          try {
            await signInWithEmailAndPassword(auth, email, password)
            return // onAuthStateChanged troca o ID token pelo token da API
          } catch (err) {
            if (!FIREBASE_MISSING_ACCOUNT.includes(err.code)) throw err
            firebaseError = err
          }
        }
        try {
          startSession(await api.post('/auth/login', { email, password }))
        } catch (err) {
          throw firebaseError ?? err
        }
      },

      register: async (name, email, password) => {
        if (!auth) {
          startSession(await api.post('/auth/register', { name, email, password }))
          return
        }
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(cred.user, { displayName: name })
        // O listener pode trocar o token antes do nome existir: grava o nome definitivo na API.
        const me = await exchange(cred.user, name)
        if (me.name !== name) setUser(await api.patch('/auth/me', { name }))
      },

      loginWithGoogle: () => signInWithPopup(requireAuth(), new GoogleAuthProvider()),
      resetPassword: (email) => sendPasswordResetEmail(requireAuth(), email),

      updateName: async (name) => setUser(await api.patch('/auth/me', { name })),
      updateMe: async (changes) => setUser(await api.patch('/auth/me', changes)),

      logout: async () => {
        endSession()
        if (auth) await signOut(auth)
      },
    }),
    [user, token, loading, startSession, endSession, exchange],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}

// Traduz erros do Firebase e da API para mensagens em português.
export function authErrorMessage(err) {
  switch (err?.code || err?.message) {
    case 'firebase-not-configured':
      return 'Esta função precisa do Firebase. Preencha o arquivo .env (veja .env.example).'
    case 'name-required':
      return 'Informe seu nome.'
    case 'auth/invalid-email':
      return 'E-mail inválido.'
    case 'auth/missing-password':
      return 'Informe a senha.'
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'INVALID_CREDENTIALS':
      return 'E-mail ou senha incorretos.'
    case 'auth/email-already-in-use':
    case 'EMAIL_IN_USE':
      return 'Já existe uma conta com este e-mail.'
    case 'auth/weak-password':
      return 'A senha precisa ter pelo menos 6 caracteres.'
    case 'VALIDATION_ERROR':
      return err.details?.[0]?.message ?? 'Confira os dados informados.'
    case 'auth/too-many-requests':
    case 'TOO_MANY_REQUESTS':
      return 'Muitas tentativas. Aguarde um pouco e tente novamente.'
    case 'auth/network-request-failed':
    case 'NETWORK':
      return 'Sem conexão. Verifique sua internet.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Login com Google cancelado.'
    case 'auth/operation-not-allowed':
      return 'Este método de login não está habilitado no Firebase.'
    default:
      return 'Não foi possível concluir. Tente novamente.'
  }
}
