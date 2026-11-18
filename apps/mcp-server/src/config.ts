// Configuração lida das variáveis de ambiente.
export interface Config {
  apiUrl: string
  token?: string
  email?: string
  password?: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiUrl = (env.VIZINHOHUB_API_URL?.trim() || 'http://localhost:3333').replace(/\/+$/, '')
  const token = env.VIZINHOHUB_API_TOKEN?.trim() || undefined
  const email = env.VIZINHOHUB_EMAIL?.trim() || undefined
  const password = env.VIZINHOHUB_PASSWORD || undefined
  if (!token && !(email && password)) {
    throw new Error(
      'Credenciais ausentes: defina VIZINHOHUB_API_TOKEN (JWT do lojista) ou VIZINHOHUB_EMAIL + VIZINHOHUB_PASSWORD.',
    )
  }
  return { apiUrl, token, email, password }
}
