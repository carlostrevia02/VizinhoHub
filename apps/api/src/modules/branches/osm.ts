// Filiais a partir do OpenStreetMap (módulo puro, sem banco e sem rede): consulta Overpass, parse dos elementos,
// classificação "nome -> rede", descarte de falsos positivos e deduplicação por proximidade.
// A gravação fica em import.ts; a busca de rede fica no script (scripts/import-branches.ts) via fetchOverpass.
import { haversineM } from './routing.js'

/** Caixa de Fortaleza (sul, oeste, norte, leste) — a mesma da consulta Overpass. Coordenada fora dela é descartada. */
export const FORTALEZA_BBOX = { south: -3.9, west: -38.66, north: -3.68, east: -38.4 } as const

/** Duas lojas da mesma rede a menos disso são a mesma loja (ex.: um node e uma way do mesmo prédio). */
export const DEDUP_RADIUS_M = 40

/**
 * Consulta Overpass validada à mão. Usa bbox (a consulta por `area` estoura o tempo limite no servidor público).
 * O filtro de nome é largo de propósito; quem decide a rede é classifyOsmPoints.
 */
export const OVERPASS_QUERY = `[out:json][timeout:50][bbox:${FORTALEZA_BBOX.south},${FORTALEZA_BBOX.west},${FORTALEZA_BBOX.north},${FORTALEZA_BBOX.east}];
nwr["shop"~"supermarket|convenience|wholesale"]["name"~"São Luiz|Sao Luiz|Pinheiro|Cometa|Assaí|Atacadão|Frangolândia|Pão de Açúcar|Carnaúba|Guará|Mezael|Araripe|Mirelly|Centerbox|Lagoa|Mega|Popular|Baratão|Telefrango|Do Povo",i];
out center tags;`

export const inFortaleza = (lat: number, lng: number) =>
  lat >= FORTALEZA_BBOX.south && lat <= FORTALEZA_BBOX.north && lng >= FORTALEZA_BBOX.west && lng <= FORTALEZA_BBOX.east

// ---- Tipos --------------------------------------------------------------------------------------------

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

export interface OsmPoint {
  /** 'node/123' | 'way/123' | 'relation/123' */
  ref: string
  lat: number
  lng: number
  tags: Record<string, string>
}

/** Filial pronta para gravar. `score` (quantas tags de endereço o OSM tem) só serve para escolher entre duplicatas. */
export interface Branch {
  chain: string
  name: string
  address: string | null
  neighborhood: string | null
  lat: number
  lng: number
  ref: string
  score?: number
}

export interface IgnoredPoint {
  ref: string
  name: string
  reason: string
}

// ---- Parse --------------------------------------------------------------------------------------------

/** Elementos Overpass -> pontos. Node usa lat/lon; way/relation usam `center`. Sem coordenada ou sem tags: some. */
export function parseOverpassElements(elements: OverpassElement[]): OsmPoint[] {
  const points: OsmPoint[] = []
  for (const el of elements) {
    if (el.type !== 'node' && el.type !== 'way' && el.type !== 'relation') continue
    const lat = el.type === 'node' ? el.lat : (el.center?.lat ?? el.lat)
    const lng = el.type === 'node' ? el.lon : (el.center?.lon ?? el.lon)
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (!el.tags) continue
    points.push({ ref: `${el.type}/${el.id}`, lat, lng, tags: el.tags })
  }
  return points
}

// ---- Classificação nome -> rede -----------------------------------------------------------------------

/** Minúsculas, sem acento. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Sem acento/caixa e com tudo que não é letra/dígito virando espaço único. */
export const normalizeName = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim()

/** "Baratão Supermercados | Siqueira", "CenterBox - Jangurussu", "Super do Povo (Passaré)" -> só a parte da marca. */
function headOf(name: string): string {
  const head = fold(name).split(/\s[-–—|]\s|\s*[(|]/)[0] ?? ''
  return normalizeName(head)
}

interface ChainRule {
  slug: string
  /** Trecho de regex (já sem acento) do nome da marca. */
  core: string
  /** Trecho mais frouxo, só para reconhecer menção à marca e confirmar por brand/operator (padrão: `core`). */
  looseCore?: string
  /** Palavras permitidas ANTES do nome (ex.: "super", "mini mercadinho"). Opcional por padrão. */
  prefix?: string
  /** O prefixo é obrigatório (marca curta e genérica demais para valer sozinha). */
  prefixRequired?: boolean
  /** Palavras permitidas DEPOIS do nome (ex.: "supermercados", "economico"). */
  suffix?: string
  /** Aceita qualquer coisa depois do nome (ex.: "Super Baratão Curió"). Só para marcas bem distintivas. */
  trailing?: boolean
  /** Se o nome casar com isto, é outra coisa (ex.: "mini market"). */
  deny?: RegExp
}

const SUPER = '(?:supermercados?|super)'

// A ordem não importa. A regra é restritiva: o nome inteiro (antes de " - ", " | " ou "(") precisa ser a marca com
// prefixos/sufixos conhecidos. Em caso de dúvida o nome NÃO casa e vai para a lista de ignorados.
const RULES: ChainRule[] = [
  { slug: 'assai', core: 'assai', suffix: 'atacadista' },
  { slug: 'atacadao', core: 'atacadao' },
  { slug: 'frangolandia', core: 'frangolandia', prefix: SUPER, suffix: 'supermercados?' },
  { slug: 'popular', core: 'popular atacadista', looseCore: 'popular' },
  {
    slug: 'sao-luiz',
    core: 'sao luiz',
    prefix: '(?:hiper|super|mini|supermercados?|mercadinhos?|mercadao)',
    suffix: 'supermercados?',
  },
  { slug: 'cometa', core: 'cometa', prefix: SUPER, suffix: '(?:supermercados?|economico)' },
  { slug: 'pinheiro', core: 'pinheiro', prefix: SUPER, suffix: 'supermercados?' },
  { slug: 'lagoa', core: 'lagoa', prefix: SUPER, prefixRequired: true },
  { slug: 'centerbox', core: 'center ?box', prefix: SUPER, suffix: 'supermercados?' },
  { slug: 'guara', core: 'guara', prefix: SUPER, suffix: 'supermercados?', trailing: true },
  { slug: 'pao-de-acucar', core: 'pao de acucar', prefix: SUPER },
  { slug: 'do-povo', core: 'do povo', prefix: SUPER, prefixRequired: true, trailing: true, deny: /mini ?market|feirao|mercadinho/ },
  { slug: 'mega', core: 'mega atacadista', looseCore: 'mega' },
  { slug: 'telefrango', core: 'telefrango', prefix: SUPER },
  { slug: 'carnauba', core: 'carnauba', prefix: SUPER, suffix: 'supermercados?' },
  { slug: 'baratao', core: 'baratao', prefix: SUPER, suffix: 'supermercados?', trailing: true },
  { slug: 'mezael', core: 'mezael', prefix: SUPER, suffix: 'supermercados?' },
  { slug: 'araripe', core: 'araripe', prefix: SUPER, suffix: 'supermercados?' },
  { slug: 'mirelly', core: 'mirelly', prefix: SUPER, suffix: 'supermercados?' },
]

interface CompiledRule {
  slug: string
  /** Nome inteiro (cabeça) é a marca. */
  strict: RegExp
  /** A marca aparece em qualquer lugar (usado só junto com brand/operator). */
  loose: RegExp
  deny?: RegExp
}

const COMPILED: CompiledRule[] = RULES.map((r) => {
  const prefix = r.prefix ? `(?:${r.prefix} )${r.prefixRequired ? '' : '?'}` : ''
  const prefixLoop = r.slug === 'sao-luiz' ? `(?:${r.prefix} )*` : prefix // "Super Mercadinho São Luiz": vários prefixos
  const suffix = r.suffix ? `(?: ${r.suffix})?` : ''
  const trailing = r.trailing ? '(?: .+)?' : ''
  return {
    slug: r.slug,
    strict: new RegExp(`^${prefixLoop}${r.core}${suffix}${trailing}$`),
    loose: new RegExp(`\\b${r.looseCore ?? r.core}\\b`),
    deny: r.deny,
  }
})

/** Slugs das redes (na ordem de RULES). */
export const CHAIN_SLUGS = RULES.map((r) => r.slug)

export type Classification = { slug: string } | { slug: null; reason: string }

/**
 * Decide a rede de um ponto do OSM. Só devolve uma rede quando há certeza:
 * - o nome (antes de " - ", " | ", "(") é a marca, com prefixos/sufixos conhecidos ("Mercadão São Luiz", "Cometa Economico");
 * - OU o nome só CONTÉM a marca e a tag brand/operator confirma a mesma rede;
 * - brand/operator apontando para OUTRA rede (ex.: "Atacadão Lag", operador Super Lagoa) é conflito: descarta.
 * Nomes que casam mais de uma rede também são descartados. Tudo que cai fora volta com o motivo.
 */
export function classifyName(name: string, tags: Record<string, string> = {}): Classification {
  const head = headOf(name)
  if (!head) return { slug: null, reason: 'sem nome' }
  const full = normalizeName(name)

  const brandText = normalizeName(`${tags.brand ?? ''} ${tags.operator ?? ''}`)
  const brandSlugs = brandText ? COMPILED.filter((r) => r.loose.test(brandText)).map((r) => r.slug) : []

  const strict = COMPILED.filter((r) => r.strict.test(head) && !r.deny?.test(full)).map((r) => r.slug)
  if (strict.length > 1) return { slug: null, reason: `nome ambíguo (casa mais de uma rede: ${strict.join(', ')})` }
  if (strict.length === 1) {
    const slug = strict[0]!
    if (brandSlugs.length > 0 && !brandSlugs.includes(slug)) {
      return { slug: null, reason: `conflito: o nome diz ${slug}, mas brand/operator diz ${brandSlugs.join(', ')}` }
    }
    return { slug }
  }

  // Nenhum nome "limpo": só aceita se brand/operator confirmar UMA rede que o nome também menciona.
  const confirmed = COMPILED.filter((r) => brandSlugs.includes(r.slug) && r.loose.test(full) && !r.deny?.test(full))
  if (confirmed.length === 1) return { slug: confirmed[0]!.slug }
  if (confirmed.length > 1) return { slug: null, reason: `nome ambíguo (brand/operator confirma mais de uma rede)` }

  const mentioned = COMPILED.filter((r) => r.loose.test(full)).map((r) => r.slug)
  if (mentioned.length > 0) {
    return { slug: null, reason: `nome parecido com ${mentioned.join(', ')}, mas sem a marca exata nem brand/operator que confirme` }
  }
  return { slug: null, reason: 'nome não corresponde a nenhuma rede' }
}

// ---- Montagem da filial -------------------------------------------------------------------------------

const clean = (v: string | undefined) => {
  const t = v?.replace(/\s+/g, ' ').trim()
  return t ? t : null
}

/** "rua, número" (só a rua se faltar o número; null se faltar a rua). */
export function buildAddress(tags: Record<string, string>): string | null {
  const street = clean(tags['addr:street'])
  if (!street) return null
  const number = clean(tags['addr:housenumber'])
  return number ? `${street}, ${number}` : street
}

const addressScore = (tags: Record<string, string>) =>
  ['addr:street', 'addr:housenumber', 'addr:suburb', 'addr:neighbourhood', 'addr:postcode', 'addr:city'].filter((k) => clean(tags[k])).length

export interface ClassifyResult {
  branches: Branch[]
  ignored: IgnoredPoint[]
}

/** Classifica os pontos do OSM em filiais (sem deduplicar) e a lista de descartes com o motivo. */
export function classifyOsmPoints(points: OsmPoint[]): ClassifyResult {
  const branches: Branch[] = []
  const ignored: IgnoredPoint[] = []
  for (const p of points) {
    const name = clean(p.tags.name)
    if (!name) {
      ignored.push({ ref: p.ref, name: '(sem nome)', reason: 'sem nome' })
      continue
    }
    const result = classifyName(name, p.tags)
    if (result.slug === null) {
      ignored.push({ ref: p.ref, name, reason: result.reason })
      continue
    }
    if (!inFortaleza(p.lat, p.lng)) {
      ignored.push({ ref: p.ref, name, reason: 'coordenada fora de Fortaleza' })
      continue
    }
    branches.push({
      chain: result.slug,
      name: name.slice(0, 120),
      address: buildAddress(p.tags),
      neighborhood: clean(p.tags['addr:suburb']) ?? clean(p.tags['addr:neighbourhood']),
      lat: p.lat,
      lng: p.lng,
      ref: p.ref,
      score: addressScore(p.tags),
    })
  }
  return { branches, ignored }
}

// ---- Deduplicação -------------------------------------------------------------------------------------

/**
 * Dentro da mesma rede, registros a menos de `radiusM` um do outro são a mesma loja: fica o que tem mais tags de
 * endereço (empate: o de ref menor, para o resultado ser estável). `dropped` traz o que foi removido, para o relatório.
 */
export function dedupeBranches(branches: Branch[], radiusM = DEDUP_RADIUS_M): { kept: Branch[]; dropped: Branch[] } {
  const ordered = [...branches].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.ref.localeCompare(b.ref))
  const kept: Branch[] = []
  const dropped: Branch[] = []
  for (const b of ordered) {
    const twin = kept.find((k) => k.chain === b.chain && haversineM(k, b) < radiusM)
    if (twin) dropped.push(b)
    else kept.push(b)
  }
  return { kept, dropped }
}

/** Atalho: classifica e deduplica. */
export function branchesFromOsm(points: OsmPoint[]): ClassifyResult & { duplicates: Branch[] } {
  const { branches, ignored } = classifyOsmPoints(points)
  const { kept, dropped } = dedupeBranches(branches)
  return { branches: kept, ignored, duplicates: dropped }
}
