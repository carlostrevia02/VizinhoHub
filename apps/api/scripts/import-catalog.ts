// Importa o catálogo de exemplo (db/catalog) para o banco, como produtos de um comerciante.
//   npm run import-catalog                                   → loja do Zé (ze@vizinhohub.test)
//   npm run import-catalog -- --merchant lucia@vizinhohub.test
//   npm run import-catalog -- --demo-offers                  → faz os itens da lista "ofertas" vencerem em 1–3 dias,
//                                                              para a vitrine mostrar o Salva-Estoque (só desenvolvimento)
//   npm run import-catalog -- --sem-ampliacao                → ignora db/catalog/ampliacao.json
// Ampliação (opcional): se db/catalog/ampliacao.json existir, seus produtos (sem id/img, imagem NULL) e seus
// departamentos novos também são importados. O `dept` de cada produto pode ser um slug de curated.json ou da ampliação.
// A flag --demo-offers continua usando só curated.ofertas / products.json.
// Idempotente: produto com o mesmo nome na mesma loja é ignorado (rodar de novo não duplica).
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createPool, withTransaction } from '../src/shared/db.js'
import { loadEnv } from '../src/shared/env.js'

interface CatalogProduct {
  id: number
  name: string
  dept: string
  price: number
  stock: number
  unit: string
  img: string
  description: string
}
interface AmpliacaoProduct {
  name: string
  dept: string
  price: number
  stock: number
  unit: string
  description: string
}
interface Ampliacao {
  departments: { slug: string; nome: string }[]
  products: AmpliacaoProduct[]
}
interface Curated {
  departments: { slug: string; nome: string; ids: number[] }[]
  ofertas: number[]
}

const { values } = parseArgs({
  options: {
    merchant: { type: 'string', default: 'ze@vizinhohub.test' },
    'demo-offers': { type: 'boolean', default: false },
    'sem-ampliacao': { type: 'boolean', default: false },
  },
})
const env = loadEnv()
if (env.NODE_ENV === 'production') throw new Error('import-catalog não roda em produção.')

const dataDir = path.resolve(import.meta.dirname, '../../../db/catalog')
const products: CatalogProduct[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf8'))
const curated: Curated = JSON.parse(fs.readFileSync(path.join(dataDir, 'curated.json'), 'utf8'))
const deptName = new Map(curated.departments.map((d) => [d.slug, d.nome]))

// Catálogo ampliado (opcional): departamentos novos entram no mesmo mapa slug → nome.
const ampliacaoFile = path.join(dataDir, 'ampliacao.json')
let ampliacao: Ampliacao = { departments: [], products: [] }
if (!values['sem-ampliacao'] && fs.existsSync(ampliacaoFile)) {
  ampliacao = JSON.parse(fs.readFileSync(ampliacaoFile, 'utf8'))
  for (const d of ampliacao.departments ?? []) deptName.set(d.slug, d.nome)
  ampliacao.products ??= []
}

const db = createPool(env.DATABASE_URL)
try {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1 AND role = 'MERCHANT'`, [values.merchant])
  const owner = rows[0]?.id
  if (!owner) throw new Error(`Comerciante ${values.merchant} não existe (veja npm run create-merchant).`)

  const inserted = await withTransaction(db, async (tx) => {
    const categoryId = new Map<string, number>()
    for (const name of new Set(deptName.values())) {
      const r = await tx.query<{ id: number }>(
        `INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [name],
      )
      categoryId.set(name, r.rows[0]!.id)
    }

    let count = 0
    let countAmpliacao = 0
    // Produtos do catálogo base (com imagem) e da ampliação (sem imagem → NULL).
    const todos = [
      ...products.map((p) => ({ ...p, rotulo: String(p.id), ampliado: false })),
      ...ampliacao.products.map((p) => ({ ...p, img: null as string | null, rotulo: `"${p.name}"`, ampliado: true })),
    ]
    for (const p of todos) {
      const category = categoryId.get(deptName.get(p.dept) ?? '')
      if (!category) throw new Error(`Departamento desconhecido "${p.dept}" no produto ${p.rotulo}.`)
      const r = await tx.query(
        `INSERT INTO products (user_id, category_id, name, description, price, stock_qty, unit, image)
         SELECT $1::uuid, $2::int, $3::varchar, $4::text, $5::numeric, $6::int, $7::varchar, $8::varchar
          WHERE NOT EXISTS (SELECT 1 FROM products WHERE user_id = $1::uuid AND name = $3::varchar)`,
        [owner, category, p.name, p.description, p.price, p.stock, p.unit, p.img],
      )
      count += r.rowCount ?? 0
      if (p.ampliado) countAmpliacao += r.rowCount ?? 0
    }
    // Ofertas de demonstração: validade em 1, 2 e 3 dias → 50%, 30% e 30% de desconto (regra do banco).
    if (values['demo-offers']) {
      const names = curated.ofertas.map((id) => products.find((p) => p.id === id)?.name).filter(Boolean)
      for (const [i, name] of names.entries()) {
        await tx.query(`UPDATE products SET expiration_date = current_date + $3::int WHERE user_id = $1 AND name = $2`, [owner, name, (i % 3) + 1])
      }
      await tx.query('SELECT refresh_clearance()')
      console.log(`${names.length} oferta(s) de demonstração (Salva-Estoque) criadas.`)
    }
    return { count, countAmpliacao }
  })
  const total = products.length + ampliacao.products.length
  console.log(`${inserted.count} produto(s) importado(s) para ${values.merchant} (${total - inserted.count} já existiam).`)
  console.log(`${inserted.countAmpliacao} produto(s) vieram da ampliação (${ampliacao.products.length} no arquivo).`)
} finally {
  await db.end()
}
