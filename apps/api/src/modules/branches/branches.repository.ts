import type { Db, DbClient } from '../../shared/db.js'
import type { LatLng } from './routing.js'
import type { BranchDTO } from './branches.types.js'

type Queryable = Db | DbClient

const escapeLike = (s: string) => s.replace(/[\%_]/g, '\$&')

const BRANCH_COLS = `b.id, b.name, b.address, b.neighborhood, b.latitude::float8 AS latitude, b.longitude::float8 AS longitude`

// Filiais ativas da rede, na ordem de cadastro.
export async function listActiveBranches(db: Queryable, chainId: number): Promise<BranchDTO[]> {
  const { rows } = await db.query<BranchDTO>(
    `SELECT ${BRANCH_COLS} FROM chain_branches b WHERE b.chain_id = $1 AND b.active ORDER BY b.name, b.id`,
    [chainId],
  )
  return rows
}

// Rede ativa pelo slug (undefined = não existe ou está desativada).
export async function findActiveChain(db: Queryable, slug: string): Promise<{ id: number; slug: string; name: string } | undefined> {
  const { rows } = await db.query<{ id: number; slug: string; name: string }>(
    `SELECT id, slug, name FROM retail_chains WHERE slug = $1 AND active`,
    [slug],
  )
  return rows[0]
}

// As `limit` filiais ativas mais perto do ponto em linha reta (earthdistance), usando o índice gist de chain_branches.
// Com `neighborhood`, só as filiais daquele bairro (sem acento nem caixa).
export async function closestBranches(db: Queryable, chainId: number, origin: LatLng, limit: number, neighborhood?: string): Promise<BranchDTO[]> {
  const params: unknown[] = [chainId, origin.lat, origin.lng, limit]
  let hood = ''
  if (neighborhood) {
    params.push(escapeLike(neighborhood))
    hood = 'AND unaccent(b.neighborhood) ILIKE unaccent($5)'
  }
  const { rows } = await db.query<BranchDTO>(
    `SELECT ${BRANCH_COLS}
       FROM chain_branches b
      WHERE b.chain_id = $1 AND b.active ${hood}
      ORDER BY earth_distance(ll_to_earth(b.latitude, b.longitude), ll_to_earth($2, $3)), b.id
      LIMIT $4`,
    params,
  )
  return rows
}
