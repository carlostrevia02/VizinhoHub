// Cria os itens canônicos e as receitas curadas (idempotente) e vincula o catálogo por heurística de nome.
//   npm run link-canonicals                                  → todos os produtos ativos sem vínculo
//   npm run link-canonicals -- --merchant ze@vizinhohub.test → só a loja informada
//   npm run link-canonicals -- --dry-run                     → só relata, não grava
// Conservador: produto que casa com 0 ou 2+ regras fica sem vínculo. Vínculo manual do lojista nunca é sobrescrito.
import { parseArgs } from 'node:util'
import { createPool } from '../src/shared/db.js'
import { loadEnv } from '../src/shared/env.js'
import { linkCatalog, seedReferenceData } from '../src/modules/smart-cart/smart-cart.seed.js'

const { values } = parseArgs({ options: { merchant: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } } })
const env = loadEnv()
if (env.NODE_ENV === 'production') throw new Error('link-canonicals não roda em produção.')

const db = createPool(env.DATABASE_URL)
try {
  let merchantId: string | undefined
  if (values.merchant) {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1 AND role = 'MERCHANT'`, [values.merchant])
    merchantId = rows[0]?.id
    if (!merchantId) throw new Error(`Comerciante ${values.merchant} não existe.`)
  }
  if (!values['dry-run']) {
    const seeded = await seedReferenceData(db)
    console.log(`${seeded.canonicals} item(ns) canônico(s) e ${seeded.recipes} receita(s) criados.`)
  }
  const r = await linkCatalog(db, { merchantId, dryRun: values['dry-run'] })
  console.log(
    `${values['dry-run'] ? '[simulação] ' : ''}${r.linked}/${r.total} produtos vinculados (${(r.rate * 100).toFixed(1)}%): ` +
      `${r.byName} por nome, ${r.byBarcode} por código de barras; ${r.ambiguous} ambíguos; ${r.unlinked} sem correspondência.`,
  )
  for (const [name, n] of Object.entries(r.perCanonical).sort()) console.log(`  ${String(n).padStart(3)} × ${name}`)
} finally {
  await db.end()
}
