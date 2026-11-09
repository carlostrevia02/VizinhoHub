// Cria (ou promove) um comerciante. Cadastro público da API só gera CUSTOMER — comerciante nasce aqui.
//   npm run create-merchant -- --email loja@exemplo.com --name "Nome" --store "Mercadinho X" \
//        --neighborhood Aldeota --city Fortaleza [--lat -3.7371 --lng -38.496] [--password senha-com-8+]
// E-mail que já existe (ex.: cliente que entrou pelo Firebase) é promovido; novo usuário exige --password.
import { parseArgs } from 'node:util'
import { createPool } from '../src/shared/db.js'
import { loadEnv } from '../src/shared/env.js'
import { hashPassword } from '../src/shared/password.js'

const { values: a } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    store: { type: 'string' },
    neighborhood: { type: 'string' },
    city: { type: 'string' },
    state: { type: 'string', default: 'CE' },
    lat: { type: 'string' },
    lng: { type: 'string' },
    password: { type: 'string' },
  },
})

const env = loadEnv()
if (env.NODE_ENV === 'production') throw new Error('create-merchant só em desenvolvimento; em produção use o painel/migração.')
if (!a.email || !a.store || !a.neighborhood || !a.city) {
  throw new Error('Uso: npm run create-merchant -- --email <e-mail> --store <loja> --neighborhood <bairro> --city <cidade> [--name] [--password] [--lat --lng]')
}

const db = createPool(env.DATABASE_URL)
try {
  const geo = [a.lat ? Number(a.lat) : null, a.lng ? Number(a.lng) : null]
  const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [a.email])
  if (existing.rows[0]) {
    await db.query(
      `UPDATE users SET role = 'MERCHANT', store_name = $2, neighborhood = $3, city = $4, state = $5, latitude = $6, longitude = $7
        WHERE id = $1`,
      [existing.rows[0].id, a.store, a.neighborhood, a.city, a.state, ...geo],
    )
    console.log(`Usuário ${a.email} promovido a MERCHANT (${a.store}).`)
  } else {
    if (!a.password || a.password.length < 8) throw new Error('Usuário novo: informe --password com 8+ caracteres.')
    await db.query(
      `INSERT INTO users (name, email, password_hash, role, store_name, neighborhood, city, state, latitude, longitude)
       VALUES ($1, $2, $3, 'MERCHANT', $4, $5, $6, $7, $8, $9)`,
      [a.name ?? a.store, a.email, await hashPassword(a.password), a.store, a.neighborhood, a.city, a.state, ...geo],
    )
    console.log(`Comerciante ${a.email} criado (${a.store}).`)
  }
} finally {
  await db.end()
}
