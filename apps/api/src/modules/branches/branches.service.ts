import type { Db } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import * as repo from './branches.repository.js'
import type { BranchDTO, NearestBranchDTO } from './branches.types.js'
import { createRouter, estimateRoute, haversineM, type LatLng, type RouteResult, type Router } from './routing.js'

// Raio (m) em que o cliente é considerado "na loja". O dono pediu "menos de 5 m", mas o GPS de celular erra de 5 a 30 m:
// com 5 m quase ninguém parado na porta seria reconhecido. Por isso o padrão é 50 m, ajustável por BRANCH_AT_RADIUS_M.
const DEFAULT_AT_BRANCH_RADIUS_M = 50
function radiusFromEnv(raw: string | undefined): number {
  const n = Number(raw)
  return raw && Number.isFinite(n) && n > 0 ? n : DEFAULT_AT_BRANCH_RADIUS_M
}
export const AT_BRANCH_RADIUS_M = radiusFromEnv(process.env.BRANCH_AT_RADIUS_M)

// Quantas filiais (em linha reta) entram na consulta de rota: uma única chamada ao OSRM resolve as três.
export const ROUTE_CANDIDATES = 3

export interface NearestBranchOptions {
  /** Bairro da oferta: se houver filiais ativas dele, só elas valem (a oferta é daquela loja). */
  neighborhood?: string | null
}

export function createBranchesService(deps: { db: Db; router?: Router; atBranchRadiusM?: number }) {
  const { db } = deps
  const router = deps.router ?? createRouter()
  const radius = deps.atBranchRadiusM ?? AT_BRANCH_RADIUS_M

  // A rota nunca deveria lançar por falha de rede; se um router injetado lançar, a estimativa local salva a resposta.
  async function routeTo(origin: LatLng, dests: LatLng[]): Promise<RouteResult[]> {
    try {
      return await router.route(origin, dests)
    } catch {
      return dests.map((d) => ({ ...estimateRoute(origin, d), estimated: true }))
    }
  }

  // Filial mais rápida de alcançar a partir de `origin`. null = a rede não tem filial cadastrada.
  async function nearestBranch(chainId: number, origin: LatLng, opts: NearestBranchOptions = {}): Promise<NearestBranchDTO | null> {
    let candidates: BranchDTO[] = []
    if (opts.neighborhood) candidates = await repo.closestBranches(db, chainId, origin, ROUTE_CANDIDATES, opts.neighborhood)
    if (candidates.length === 0) candidates = await repo.closestBranches(db, chainId, origin, ROUTE_CANDIDATES)
    if (candidates.length === 0) return null

    // Já na loja: a mais próxima em linha reta dentro do raio vale, sem gastar uma consulta de rota.
    const straight = candidates.map((c) => haversineM(origin, { lat: c.latitude, lng: c.longitude }))
    const here = straight.indexOf(Math.min(...straight))
    if (straight[here]! <= radius) {
      return { ...candidates[here]!, distanceM: Math.round(straight[here]!), durationS: 0, estimated: false, atBranch: true }
    }

    const routes = await routeTo(
      origin,
      candidates.map((c) => ({ lat: c.latitude, lng: c.longitude })),
    )
    let best = 0
    routes.forEach((r, i) => {
      if (r.durationS < routes[best]!.durationS) best = i
    })
    const r = routes[best]!
    return { ...candidates[best]!, distanceM: Math.round(r.distanceM), durationS: Math.round(r.durationS), estimated: r.estimated, atBranch: false }
  }

  // Filiais ativas de uma rede pelo slug; 404 se a rede não existe.
  async function listByChain(slug: string): Promise<BranchDTO[]> {
    const chain = await repo.findActiveChain(db, slug)
    if (!chain) throw new AppError(404, 'CHAIN_NOT_FOUND', 'Rede não encontrada.')
    return repo.listActiveBranches(db, chain.id)
  }

  return { nearestBranch, listByChain }
}

export type BranchesService = ReturnType<typeof createBranchesService>
