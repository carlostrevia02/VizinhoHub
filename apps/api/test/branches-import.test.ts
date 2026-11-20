// Importação de filiais (etapa 11.1), sem rede: classificação nome -> rede, parse de node/way, deduplicação por 40 m,
// busca na Overpass com fetch falso e gravação (upsert idempotente + desativação das que sumiram) num banco de teste.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { parseBranchesFile, syncBranches } from '../src/modules/branches/import.js'
import {
  branchesFromOsm,
  buildAddress,
  classifyName,
  dedupeBranches,
  inFortaleza,
  parseOverpassElements,
  type Branch,
  type OverpassElement,
} from '../src/modules/branches/osm.js'
import { fetchOverpass } from '../src/modules/branches/overpass.js'
import { startTestEnv, type TestEnv } from './helpers.js'

const slugOf = (name: string, tags: Record<string, string> = {}) => classifyName(name, tags).slug

describe('classificação nome -> rede', () => {
  it('reconhece as variações reais de nome', () => {
    const casos: [string, string][] = [
      ['Mercadinhos São Luiz', 'sao-luiz'],
      ['Mercadão São Luiz', 'sao-luiz'],
      ['Super Mercadinho São Luiz', 'sao-luiz'],
      ['Super Mercadinhos São Luiz', 'sao-luiz'],
      ['Hiper Mercadinhos São Luiz', 'sao-luiz'],
      ['Mini São Luiz', 'sao-luiz'],
      ['Supermercado São Luiz', 'sao-luiz'],
      ['Supermercado Cometa', 'cometa'],
      ['Cometa Economico (Serrinha)', 'cometa'],
      ['Cometa Supermercados - Castelo Branco', 'cometa'],
      ['Super do Povo (Passaré)', 'do-povo'],
      ['Super do Povo Pátio Arvoredo', 'do-povo'],
      ['CenterBox - Jangurussu', 'centerbox'],
      ['Centerbox Supermercados', 'centerbox'],
      ['Baratão Supermercados | Siqueira', 'baratao'],
      ['Super Baratão Curió', 'baratao'],
      ['Atacadão', 'atacadao'],
      ['Assaí Atacadista', 'assai'],
      ['Supermercado Pão de Açúcar', 'pao-de-acucar'],
      ['Pão de Açúcar', 'pao-de-acucar'],
      ['Super Lagoa', 'lagoa'],
      ['Mega Atacadista', 'mega'],
      ['Supermercado Guará Le Petit Iracema', 'guara'],
      ['Supermercado Telefrango (Passaré)', 'telefrango'],
      ['SUPERMERCADO FRANGOLANDIA', 'frangolandia'],
      ['Supermercado Carnaúba', 'carnauba'],
      ['Araripe Supermercado', 'araripe'],
      ['Mirelly Supermercado', 'mirelly'],
      ['Supermercado Mezael', 'mezael'],
      ['Pinheiro Supermercado', 'pinheiro'],
      ['Popular Atacadista', 'popular'],
    ]
    for (const [nome, slug] of casos) assert.equal(slugOf(nome), slug, nome)
  })

  it('descarta falsos positivos', () => {
    const descartes = [
      'Bomboniere Atacadão das Balas',
      'Atacadão do Alumínio',
      'Atacadão Lag',
      'MD Atacadão',
      'Mercadinho Popular',
      'Mercadinho Feirão do Povo',
      'Do Povo Mini Market',
      'Supermercado do Povo Mini Market',
      'Mercantil Pinheiro',
      'Mercadinho Lagoa Azul',
      'Mega Farma',
    ]
    for (const nome of descartes) {
      const r = classifyName(nome)
      assert.equal(r.slug, null, nome)
      assert.ok('reason' in r && r.reason.length > 0, `${nome} precisa de motivo`)
    }
  })

  it('brand/operator reforça: aceita nome que só contém a marca e descarta conflito', () => {
    // "Mercadinho Popular" só vira a rede Popular se a marca do OSM disser isso.
    assert.equal(slugOf('Mercadinho Popular', { brand: 'Popular Atacadista' }), 'popular')
    assert.equal(slugOf('Mercadinho Popular', { operator: 'Outra Coisa' }), null)
    // Nome diz São Luiz, marca diz Pão de Açúcar: conflito -> descarta.
    const c = classifyName('São Luiz Supermercado', { brand: 'Pão de Açúcar', operator: 'Grupo Pão de Açúcar' })
    assert.equal(c.slug, null)
    assert.match((c as { reason: string }).reason, /conflito/)
    // Atacadão com operador de outra rede (Atacadão Lag é do Super Lagoa).
    assert.equal(slugOf('Atacadão', { operator: 'Super Lagoa' }), null)
    // Operador do grupo (Assaí pertenceu ao Pão de Açúcar) não conflita quando a marca é a própria rede.
    assert.equal(slugOf('Assaí Atacadista', { brand: 'Assaí Atacadista', operator: 'Grupo Pão de Açúcar' }), 'assai')
    // Marca coerente com o nome não atrapalha.
    assert.equal(slugOf('Atacadão', { brand: 'Atacadão' }), 'atacadao')
  })

  it('nome que casa mais de uma rede é descartado como ambíguo', () => {
    // Sem acento/caixa: "mega atacadista" + "popular atacadista" nunca viram uma coisa só.
    const r = classifyName('Super Pinheiro Cometa Supermercado')
    assert.equal(r.slug, null)
  })
})

describe('parse do Overpass', () => {
  const elements: OverpassElement[] = [
    { type: 'node', id: 1, lat: -3.73, lon: -38.52, tags: { name: 'Supermercado Cometa', 'addr:street': 'Rua A', 'addr:housenumber': '10', 'addr:suburb': 'Aldeota' } },
    { type: 'way', id: 2, center: { lat: -3.74, lon: -38.51 }, tags: { name: 'Super Lagoa', 'addr:street': 'Av. B', 'addr:neighbourhood': 'Centro' } },
    { type: 'relation', id: 3, center: { lat: -3.75, lon: -38.5 }, tags: { name: 'Atacadão' } },
    { type: 'way', id: 4, tags: { name: 'Sem centro' } },
    { type: 'node', id: 5, lat: -3.7, lon: -38.5 },
  ]

  it('node usa lat/lon; way/relation usam center; descarta sem coordenada ou sem tags', () => {
    const pts = parseOverpassElements(elements)
    assert.deepEqual(
      pts.map((p) => [p.ref, p.lat, p.lng]),
      [
        ['node/1', -3.73, -38.52],
        ['way/2', -3.74, -38.51],
        ['relation/3', -3.75, -38.5],
      ],
    )
  })

  it('monta endereço "rua, número" e bairro', () => {
    const { branches } = branchesFromOsm(parseOverpassElements(elements))
    const byRef = new Map(branches.map((b) => [b.ref, b]))
    assert.equal(byRef.get('node/1')?.address, 'Rua A, 10')
    assert.equal(byRef.get('node/1')?.neighborhood, 'Aldeota')
    assert.equal(byRef.get('node/1')?.chain, 'cometa')
    assert.equal(byRef.get('way/2')?.address, 'Av. B')
    assert.equal(byRef.get('way/2')?.neighborhood, 'Centro')
    assert.equal(byRef.get('relation/3')?.address, null)
    assert.equal(byRef.get('relation/3')?.neighborhood, null)
    assert.equal(buildAddress({ 'addr:housenumber': '5' }), null)
  })

  it('coordenada fora de Fortaleza é ignorada com motivo', () => {
    const { branches, ignored } = branchesFromOsm(
      parseOverpassElements([{ type: 'node', id: 9, lat: -3.2, lon: -38.5, tags: { name: 'Supermercado Cometa' } }]),
    )
    assert.equal(branches.length, 0)
    assert.match(ignored[0]!.reason, /fora de Fortaleza/)
    assert.equal(inFortaleza(-3.73, -38.52), true)
    assert.equal(inFortaleza(-3.2, -38.5), false)
  })
})

describe('deduplicação por proximidade', () => {
  const base = { address: null, neighborhood: null, name: 'Cometa', lat: -3.73, lng: -38.52 }
  // ~0,0002° de latitude ≈ 22 m; ~0,0006° ≈ 67 m.
  it('junta registros da mesma rede a menos de 40 m e fica com o que tem mais tags de endereço', () => {
    const a: Branch = { ...base, chain: 'cometa', ref: 'node/1', score: 1 }
    const b: Branch = { ...base, chain: 'cometa', ref: 'way/2', lat: -3.7302, score: 3, address: 'Rua A, 10' }
    const { kept, dropped } = dedupeBranches([a, b])
    assert.deepEqual(kept.map((k) => k.ref), ['way/2'])
    assert.deepEqual(dropped.map((k) => k.ref), ['node/1'])
  })

  it('mantém as duas quando passam de 40 m, ou quando são de redes diferentes', () => {
    const a: Branch = { ...base, chain: 'cometa', ref: 'node/1' }
    const longe: Branch = { ...base, chain: 'cometa', ref: 'node/2', lat: -3.7306 }
    const outraRede: Branch = { ...base, chain: 'lagoa', ref: 'node/3' }
    const { kept } = dedupeBranches([a, longe, outraRede])
    assert.equal(kept.length, 3)
  })

  it('empate de score é estável (ref menor fica)', () => {
    const a: Branch = { ...base, chain: 'cometa', ref: 'way/9', score: 2 }
    const b: Branch = { ...base, chain: 'cometa', ref: 'node/1', score: 2 }
    assert.deepEqual(dedupeBranches([a, b]).kept.map((k) => k.ref), ['node/1'])
    assert.deepEqual(dedupeBranches([b, a]).kept.map((k) => k.ref), ['node/1'])
  })
})

describe('fetchOverpass (fetch falso)', () => {
  const ok = (elements: unknown[], extra: object = {}) =>
    new Response(JSON.stringify({ elements, ...extra }), { status: 200, headers: { 'content-type': 'application/json' } })

  it('cai para o espelho quando o principal falha e envia User-Agent e o campo data', async () => {
    const calls: { url: string; ua: string | null; data: string | null }[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams
      calls.push({ url: String(url), ua: new Headers(init.headers).get('user-agent'), data: body.get('data') })
      return calls.length === 1 ? new Response('# 502 Gateway Timeout', { status: 502 }) : ok([{ type: 'node', id: 1, lat: -3.73, lon: -38.52, tags: { name: 'Cometa' } }])
    }) as unknown as typeof fetch
    const els = await fetchOverpass({ endpoints: ['https://a.test/api', 'https://b.test/api'], fetchImpl, sleep: async () => {} })
    assert.equal(els.length, 1)
    assert.equal(calls.length, 2)
    assert.equal(calls[1]!.url, 'https://b.test/api')
    assert.match(calls[0]!.ua ?? '', /VizinhoHub/)
    assert.match(calls[0]!.data ?? '', /bbox:-3\.9,-38\.66,-3\.68,-38\.4/)
  })

  it('resultado truncado (remark de erro) conta como falha; esgotadas as rodadas, lança', async () => {
    let n = 0
    const fetchImpl = (async () => {
      n++
      return ok([], { remark: 'runtime error: Query timed out' })
    }) as unknown as typeof fetch
    await assert.rejects(fetchOverpass({ endpoints: ['https://a.test/api'], rounds: 2, fetchImpl, sleep: async () => {} }), /indisponível/)
    assert.equal(n, 2)
  })
})

describe('arquivo manual / Google', () => {
  it('valida entradas, aceita campos opcionais e manda o resto para ignorados', () => {
    const { branches, ignored } = parseBranchesFile([
      { chain: 'sao-luiz', name: 'São Luiz Aldeota', lat: -3.74, lng: -38.5, ref: 'ChIJ1', address: 'Rua X, 1' },
      { chain: 'cometa', name: 'Cometa sem ref', lat: -3.75, lng: -38.51 },
      { chain: 'cometa', name: 'Longe', lat: -5, lng: -38.5 },
      { chain: 'cometa', name: 'Sem coordenada' },
    ])
    assert.equal(branches.length, 2)
    assert.equal(branches[1]!.ref, '')
    assert.equal(ignored.length, 2)
    assert.throws(() => parseBranchesFile({}), /lista JSON/)
  })
})

describe('gravação (upsert + desativação)', () => {
  let t: TestEnv
  before(async () => {
    t = await startTestEnv()
  })
  after(() => t?.stop())

  const mk = (chain: string, ref: string, over: Partial<Branch> = {}): Branch => ({
    chain, ref, name: `${chain} ${ref}`, address: 'Rua A, 1', neighborhood: 'Centro', lat: -3.73, lng: -38.52, ...over,
  })
  const rows = async (where = '1=1') =>
    (await t.db.query(`SELECT cb.*, rc.slug FROM chain_branches cb JOIN retail_chains rc ON rc.id = cb.chain_id WHERE ${where} ORDER BY rc.slug, cb.source_ref`)).rows

  it('rodar duas vezes não duplica; a segunda atualiza; a que sumiu fica inativa; MANUAL/GOOGLE intactas', async () => {
    // Filiais de outras fontes que nunca podem ser desativadas pela importação do OSM.
    await syncBranches(t.db, [mk('cometa', 'g1'), mk('cometa', '')], { source: 'GOOGLE' })
    await syncBranches(t.db, [mk('cometa', '', { name: 'Manual sem ref' })], { source: 'MANUAL' })

    const first = [mk('cometa', 'node/1'), mk('cometa', 'way/2', { lat: -3.74 }), mk('lagoa', 'node/3')]
    const r1 = await syncBranches(t.db, first, { source: 'OSM', deactivateMissing: true })
    assert.deepEqual([r1.inserted, r1.updated, r1.deactivated], [3, 0, 0])
    assert.equal((await rows(`cb.source = 'OSM'`)).length, 3)

    // Segunda rodada idêntica, com um dado novo: nada duplica.
    const again = [mk('cometa', 'node/1', { name: 'Cometa renomeado', address: 'Rua B, 2', neighborhood: 'Aldeota' }), first[1]!, first[2]!]
    const r2 = await syncBranches(t.db, again, { source: 'OSM', deactivateMissing: true })
    assert.deepEqual([r2.inserted, r2.updated, r2.deactivated], [0, 3, 0])
    const osm = await rows(`cb.source = 'OSM'`)
    assert.equal(osm.length, 3)
    const n1 = osm.find((r) => r.source_ref === 'node/1')
    assert.equal(n1.name, 'Cometa renomeado')
    assert.equal(n1.address, 'Rua B, 2')
    assert.equal(n1.neighborhood, 'Aldeota')

    // Terceira: way/2 sumiu -> inativa; as demais seguem ativas.
    const r3 = await syncBranches(t.db, [again[0]!, again[2]!], { source: 'OSM', deactivateMissing: true })
    assert.deepEqual([r3.inserted, r3.updated, r3.deactivated], [0, 2, 1])
    const after3 = await rows(`cb.source = 'OSM'`)
    assert.equal(after3.length, 3)
    assert.equal(after3.find((r) => r.source_ref === 'way/2').active, false)
    assert.equal(after3.filter((r) => r.active).length, 2)

    // Voltou: reativa em vez de duplicar.
    await syncBranches(t.db, again, { source: 'OSM', deactivateMissing: true })
    const after4 = await rows(`cb.source = 'OSM'`)
    assert.equal(after4.length, 3)
    assert.equal(after4.every((r) => r.active), true)

    // Outras fontes: intactas e ativas.
    const outras = await rows(`cb.source <> 'OSM'`)
    assert.equal(outras.length, 3)
    assert.equal(outras.every((r) => r.active), true)
  })

  it('lista vazia não desativa nada (falha da fonte não é "todas fecharam")', async () => {
    const antes = (await rows(`cb.source = 'OSM' AND cb.active`)).length
    assert.ok(antes > 0)
    const r = await syncBranches(t.db, [], { source: 'OSM', deactivateMissing: true })
    assert.equal(r.deactivated, 0)
    assert.equal((await rows(`cb.source = 'OSM' AND cb.active`)).length, antes)
  })

  it('sem deactivateMissing (modo --file) não desativa; entradas sem ref reaproveitam a linha; rede desconhecida é reportada', async () => {
    const antes = (await rows(`cb.active`)).length
    const a = mk('mega', '', { name: 'Mega Cajazeiras' })
    const r1 = await syncBranches(t.db, [a, mk('inexistente', 'x')], { source: 'MANUAL' })
    assert.deepEqual([r1.inserted, r1.updated, r1.unknownChains], [1, 0, ['inexistente']])
    const r2 = await syncBranches(t.db, [{ ...a, address: 'Av. Nova, 9' }], { source: 'MANUAL' })
    assert.deepEqual([r2.inserted, r2.updated], [0, 1])
    const m = await rows(`rc.slug = 'mega'`)
    assert.equal(m.length, 1)
    assert.equal(m[0].address, 'Av. Nova, 9')
    assert.equal((await rows(`cb.active`)).length, antes + 1)
  })
})
