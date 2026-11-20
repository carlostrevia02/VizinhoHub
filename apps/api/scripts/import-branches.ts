// Importa as filiais das redes de supermercado de Fortaleza para chain_branches.
//   npm run import-branches                                 → OpenStreetMap (Overpass API, gratuita); grava e, se a importação
//                                                              completou, desativa as filiais OSM que sumiram do resultado
//   npm run import-branches -- --dry-run                    → não grava: imprime a contagem por rede e a lista de ignorados
//   npm run import-branches -- --file filiais.json          → importa de um JSON local (source MANUAL); NÃO desativa nada
//   npm run import-branches -- --file places.json --source=google   → o mesmo, marcando as filiais como GOOGLE
// Formato do JSON: [{ "chain": "sao-luiz", "name": "...", "address": "...", "neighborhood": "...", "lat": -3.73, "lng": -38.52, "ref": "id-externo" }]
// (address, neighborhood e ref são opcionais; com ref, rodar de novo atualiza em vez de duplicar).
// Idempotente. O dry-run do OSM não precisa de banco nem de .env.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { parseBranchesFile, syncBranches, type BranchSource } from '../src/modules/branches/import.js'
import { branchesFromOsm, CHAIN_SLUGS, parseOverpassElements, type Branch, type IgnoredPoint } from '../src/modules/branches/osm.js'
import { fetchOverpass } from '../src/modules/branches/overpass.js'
import { createPool } from '../src/shared/db.js'
import { loadEnv } from '../src/shared/env.js'

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    file: { type: 'string' },
    source: { type: 'string' },
  },
})
const dryRun = values['dry-run']
const file = values.file

if (values.source !== undefined && !file) throw new Error('--source só vale junto com --file.')
if (values.source !== undefined && !['google', 'manual'].includes(values.source.toLowerCase())) throw new Error('--source aceita "google" ou "manual".')
const source: BranchSource = file ? (values.source?.toLowerCase() === 'google' ? 'GOOGLE' : 'MANUAL') : 'OSM'

function printReport(branches: Branch[], ignored: IgnoredPoint[], duplicates: Branch[]) {
  const perChain = new Map<string, number>()
  for (const b of branches) perChain.set(b.chain, (perChain.get(b.chain) ?? 0) + 1)
  const slugs = [...new Set([...CHAIN_SLUGS, ...perChain.keys()])]
  console.log(`\nFiliais por rede (${branches.length} no total):`)
  for (const slug of slugs) console.log(`  ${slug.padEnd(14)} ${perChain.get(slug) ?? 0}`)
  if (duplicates.length) {
    console.log(`\nDuplicatas removidas (a menos de 40 m na mesma rede): ${duplicates.length}`)
    for (const d of duplicates) console.log(`  ${d.ref.padEnd(22)} ${d.chain.padEnd(12)} ${d.name}`)
  }
  console.log(`\nIgnorados para revisão humana (${ignored.length}):`)
  for (const i of ignored) console.log(`  ${i.ref.padEnd(22)} ${i.name} — ${i.reason}`)
}

let branches: Branch[]
let ignored: IgnoredPoint[]
let duplicates: Branch[] = []

if (file) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  ;({ branches, ignored } = parseBranchesFile(raw))
  console.log(`Arquivo ${file}: ${branches.length} filiais válidas, ${ignored.length} ignoradas (fonte ${source}).`)
} else {
  console.log('Buscando filiais no OpenStreetMap (Overpass API)...')
  const elements = await fetchOverpass({ log: console.log })
  ;({ branches, ignored, duplicates } = branchesFromOsm(parseOverpassElements(elements)))
}

printReport(branches, ignored, duplicates)

if (dryRun) {
  console.log('\n--dry-run: nada foi gravado.')
} else {
  const env = loadEnv()
  const db = createPool(env.DATABASE_URL)
  try {
    // Só a importação completa do OSM desativa: com --file a lista é parcial por natureza.
    const summary = await syncBranches(db, branches, { source, deactivateMissing: source === 'OSM' })
    console.log(`\nGravado: ${summary.inserted} novas, ${summary.updated} atualizadas, ${summary.deactivated} desativadas.`)
    if (summary.unknownChains.length) {
      console.error(`Redes desconhecidas (não gravadas): ${summary.unknownChains.join(', ')}`)
      process.exitCode = 1
    }
  } finally {
    await db.end()
  }
}
