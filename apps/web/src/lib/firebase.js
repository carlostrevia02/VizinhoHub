import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// O Firebase cuida só da identidade (e-mail/senha e Google). Perfil, papel, produtos e pedidos
// vêm da API: o ID token é trocado pelo token da API em POST /auth/firebase (AuthContext).
// Sem a chave o app continua funcionando com o login próprio da API (e-mail/senha).
export const firebaseConfigured = Boolean(config.apiKey && config.projectId)

const app = firebaseConfigured ? initializeApp(config) : null
export const auth = app ? getAuth(app) : null
