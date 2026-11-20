// Gravação das filiais das redes em chain_branches (upsert idempotente) e leitura do JSON manual/Google.
import { z } from 'zod'
import { withTransaction, type Db } from '../../shared/db.js'
import { inFortaleza, type Branch, type IgnoredPoint } from './osm.js'

export type BranchSource = 'OSM' | 'GOOGLE' | 'MANUAL'

export interface SyncOptions {
  source: BranchSource
  /**
   * Só para importação COMPLETA do OSM: filiais OSM que não vieram nesta rodada ficam active = FALSE.
   * Nunca mexe em MANUAL/GOOGLE. Com lista vazia nada é desativado (provável falha da fonte, não "todas fecharam").
   */
  deactivateMissing?: boolean
}

export interface SyncSummary {
  inserted: number
  updated: number
  deactivated: number
  /** Redes citadas pelo import que não existem em retail_chains (essas filiais não são gravadas). */
  unknownChains: string[]
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Upsert de todas as filiais (e desativação das que sumiram, se pedido) numa única transação. */
export async function syncBranches(db: Db, branches: Branch[], opts: SyncOptions): Promise<SyncSummary> {
  return withTransaction(db, async (client) => {
    const { rows: chains } = await client.query<{ id: number; slug: string }>('SELECT id, slug FROM retail_chains')
    const chainId = new Map(chains.map((c) => [c.slug, c.id]))
    const unknown = new Set<string>()
    let inserted = 0
    let updated = 0
    const seenChain: number[] = []
    const seenRef: string[] = []

    for (const b of branches) {
      const id = chainId.get(b.chain)
      if (!id) {
        unknown.add(b.chain)
        continue
      }
      const params = [id, b.name, b.address, b.neighborhood, round6(b.lat), round6(b.lng), opts.source]
      if (b.ref) {
        const { rows } = await client.query<{ inserted: boolean }>(
          `INSERT INTO chain_branches (chain_id, name, address, neighborhood, latitude, longitude, source, source_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (chain_id, source, source_ref) DO UPDATE
             SET name = EXCLUDED.name, address = EXCLUDED.address, neighborhood = EXCLUDED.neighborhood,
                 latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, active = TRUE
           RETURNING (xmax = 0) AS inserted`,
          [...params, b.ref],
        )
        if (rows[0]?.inserted) inserted++
        else updated++
        seenChain.push(id)
        seenRef.push(b.ref)
      } else {
        // Sem id externo o UNIQUE não protege (NULL é distinto de NULL): reaproveita a linha de mesmo nome e lugar.
        const { rowCount } = await client.query(
          `UPDATE chain_branches
              SET address = $3, neighborhood = $4, active = TRUE
            WHERE chain_id = $1 AND source = $7 AND source_ref IS NULL AND name = $2 AND latitude = $5 AND longitude = $6`,
          params,
        )
        if (rowCount) {
          updated++
        } else {
          await client.query(
            `INSERT INTO chain_branches (chain_id, name, address, neighborhood, latitude, longitude, source) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            params,
          )
          inserted++
        }
      }
    }

    let deactivated = 0
    if (opts.source === 'OSM' && opts.deactivateMissing && seenRef.length > 0) {
      const res = await client.query(
        `UPDATE chain_branches cb SET active = FALSE
          WHERE cb.source = 'OSM' AND cb.active
            AND NOT EXISTS (SELECT 1 FROM unnest($1::int[], $2::text[]) AS s(chain_id, ref)
                             WHERE s.chain_id = cb.chain_id AND s.ref = cb.source_ref)`,
        [seenChain, seenRef],
      )
      deactivated = res.rowCount ?? 0
    }
    return { inserted, updated, deactivated, unknownChains: [...unknown] }
  })
}

// ---- Arquivo JSON (cadastro manual / Google Places) ---------------------------------------------------

const fileEntry = z.object({
  chain: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).nullish(),
  neighborhood: z.string().trim().min(1).max(80).nullish(),
  lat: z.number().finite(),
  lng: z.number().finite(),
  ref: z.string().trim().min(1).max(40).nullish(),
})

/**
 * Lê o JSON `[{ chain, name, address?, neighborhood?, lat, lng, ref? }]`. Entrada inválida ou fora do bbox de
 * Fortaleza não derruba o arquivo: vai para `ignored` com o motivo.
 */
export function parseBranchesFile(raw: unknown): { branches: Branch[]; ignored: IgnoredPoint[] } {
  if (!Array.isArray(raw)) throw new Error('O arquivo precisa ser uma lista JSON: [{ "chain": "sao-luiz", "name": "...", "lat": -3.7, "lng": -38.5 }]')
  const branches: Branch[] = []
  const ignored: IgnoredPoint[] = []
  raw.forEach((item, i) => {
    const parsed = fileEntry.safeParse(item)
    const label = (item as { name?: unknown } | null)?.name
    const name = typeof label === 'string' ? label : `(item ${i + 1})`
    if (!parsed.success) {
      ignored.push({ ref: `item ${i + 1}`, name, reason: `inválido: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}` })
      return
    }
    const e = parsed.data
    if (!inFortaleza(e.lat, e.lng)) {
      ignored.push({ ref: e.ref ?? `item ${i + 1}`, name: e.name, reason: 'coordenada fora de Fortaleza' })
      return
    }
    branches.push({ chain: e.chain, name: e.name, address: e.address ?? null, neighborhood: e.neighborhood ?? null, lat: e.lat, lng: e.lng, ref: e.ref ?? '' })
  })
  return { branches, ignored }
}
