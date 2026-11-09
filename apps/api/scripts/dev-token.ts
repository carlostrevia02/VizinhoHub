// Gera um token de desenvolvimento para um usuário do seed.
//   npm run dev-token -- maria@vizinhohub.test
import { signToken } from '../src/shared/auth.js'
import { createPool } from '../src/shared/db.js'
import { loadEnv } from '../src/shared/env.js'

const env = loadEnv()
if (env.NODE_ENV === 'production') throw new Error('dev-token não roda em produção.')

const email = process.argv[2]
if (!email) throw new Error('Uso: npm run dev-token -- <email>')

const db = createPool(env.DATABASE_URL)
const { rows } = await db.query<{ id: string; role: string }>('SELECT id, role FROM users WHERE email = $1', [email])
await db.end()
if (!rows[0]) throw new Error(`Usuário ${email} não existe no banco.`)

console.log(`# ${email} (${rows[0].role})`)
console.log(signToken(rows[0].id, env.JWT_SECRET))
