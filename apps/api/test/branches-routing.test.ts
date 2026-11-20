// Roteamento de filiais (módulo puro): OSRM com fetch falso, fallback estimado, cache e validação.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AVG_SPEED_KMH, createRouter, estimateRoute, haversineM } from '../src/modules/branches/routing.js'

// Praça do Ferreira -> Beira Mar (Fortaleza), ~2,6 km em linha reta.
const CLIENT = { lat: -3.7275, lng: -38.5267 }
const B1 = { lat: -3.7371, lng: -38.496 }
const B2 = { lat: -3.7319, lng: -38.5023 }

const okBody = { code: 'Ok', durations: [[600, 300]], distances: [[3000, 1500]] }

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const urls: string[] = []
  const fn = (async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    return handler(url)
  }) as typeof fetch
  return { fn, urls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const noSleep = async () => {}

describe('haversine / estimativa', () => {
  it('distância conhecida em Fortaleza (~1 grau de latitude = ~111,2 km)', () => {
    const d = haversineM({ lat: -3.7, lng: -38.5 }, { lat: -4.7, lng: -38.5 })
    assert.ok(Math.abs(d - 111_195) < 300, `d=${d}`)
    assert.equal(haversineM(CLIENT, CLIENT), 0)
  })

  it('estimateRoute usa fator 1,35 e a velocidade média', () => {
    const straight = haversineM(CLIENT, B1)
    const est = estimateRoute(CLIENT, B1)
    assert.ok(Math.abs(est.distanceM - straight * 1.35) < 1e-6)
    assert.ok(Math.abs(est.durationS - est.distanceM / ((AVG_SPEED_KMH * 1000) / 3600)) < 1e-6)
  })
})

describe('createRouter', () => {
  it('OSRM ok: monta URL em lng,lat com sources/destinations e devolve valores reais', async () => {
    const f = fakeFetch(() => json(okBody))
    const router = createRouter({ fetch: f.fn, sleep: noSleep })
    const res = await router.route(CLIENT, [B1, B2])
    assert.deepEqual(res, [
      { distanceM: 3000, durationS: 600, estimated: false },
      { distanceM: 1500, durationS: 300, estimated: false },
    ])
    assert.equal(f.urls.length, 1)
    assert.equal(
      f.urls[0],
      'https://router.project-osrm.org/table/v1/driving/-38.5267,-3.7275;-38.496,-3.7371;-38.5023,-3.7319?sources=0&destinations=1;2&annotations=duration,distance',
    )
  })

  it('falha de rede: usa estimativa e marca estimated', async () => {
    const f = fakeFetch(() => {
      throw new Error('ECONNREFUSED')
    })
    const router = createRouter({ fetch: f.fn, sleep: noSleep })
    const res = await router.route(CLIENT, [B1])
    assert.equal(res.length, 1)
    assert.equal(res[0]!.estimated, true)
    assert.deepEqual({ distanceM: res[0]!.distanceM, durationS: res[0]!.durationS }, estimateRoute(CLIENT, B1))
  })

  it('status != 200 ou code != Ok: tudo estimado', async () => {
    const r500 = createRouter({ fetch: fakeFetch(() => json({}, 500)).fn, sleep: noSleep })
    assert.ok((await r500.route(CLIENT, [B1, B2])).every((r) => r.estimated))
    const rCode = createRouter({ fetch: fakeFetch(() => json({ code: 'NoRoute' })).fn, sleep: noSleep })
    assert.ok((await rCode.route(CLIENT, [B1, B2])).every((r) => r.estimated))
  })

  it('par null: só aquele par é estimado', async () => {
    const f = fakeFetch(() => json({ code: 'Ok', durations: [[600, null]], distances: [[3000, null]] }))
    const router = createRouter({ fetch: f.fn, sleep: noSleep })
    const res = await router.route(CLIENT, [B1, B2])
    assert.deepEqual(res[0], { distanceM: 3000, durationS: 600, estimated: false })
    assert.equal(res[1]!.estimated, true)
    assert.equal(res[1]!.distanceM, estimateRoute(CLIENT, B2).distanceM)
  })

  it('cache: segunda chamada igual (e coordenadas dentro de ~11 m) não chama fetch', async () => {
    const f = fakeFetch(() => json(okBody))
    const router = createRouter({ fetch: f.fn, sleep: noSleep })
    const first = await router.route(CLIENT, [B1, B2])
    const second = await router.route({ lat: CLIENT.lat + 0.00001, lng: CLIENT.lng }, [B1, B2])
    assert.equal(f.urls.length, 1)
    assert.deepEqual(second, first)
  })

  it('cache expira após o TTL e estimativas não são cacheadas', async () => {
    let t = 1_000
    let fail = true
    const f = fakeFetch(() => (fail ? json({}, 503) : json(okBody)))
    const router = createRouter({ fetch: f.fn, sleep: noSleep, now: () => t, cacheTtlMs: 5_000 })
    assert.equal((await router.route(CLIENT, [B1]))[0]!.estimated, true)
    fail = false
    assert.equal((await router.route(CLIENT, [B1]))[0]!.estimated, false) // refez a chamada
    assert.equal(f.urls.length, 2)
    await router.route(CLIENT, [B1])
    assert.equal(f.urls.length, 2) // cache
    t += 6_000
    await router.route(CLIENT, [B1])
    assert.equal(f.urls.length, 3) // expirou
  })

  it('espaça chamadas reais em pelo menos minIntervalMs', async () => {
    let t = 0
    const waits: number[] = []
    const f = fakeFetch(() => json({ code: 'Ok', durations: [[1]], distances: [[1]] }))
    const router = createRouter({
      fetch: f.fn,
      now: () => t,
      minIntervalMs: 1000,
      sleep: async (ms) => {
        waits.push(ms)
        t += ms
      },
    })
    await router.route(CLIENT, [B1])
    t += 200
    await router.route(CLIENT, [B2])
    assert.deepEqual(waits, [800])
  })

  it('coordenadas inválidas lançam erro antes de chamar o OSRM', async () => {
    const f = fakeFetch(() => json(okBody))
    const router = createRouter({ fetch: f.fn, sleep: noSleep })
    await assert.rejects(() => router.route({ lat: 91, lng: 0 }, [B1]), /inválidas/)
    await assert.rejects(() => router.route(CLIENT, [{ lat: 0, lng: 181 }]), /inválidas/)
    await assert.rejects(() => router.route(CLIENT, [{ lat: Number.NaN, lng: 0 }]), /inválidas/)
    await assert.rejects(() => router.route(CLIENT, [{ lat: 0, lng: Number.POSITIVE_INFINITY }]), /inválidas/)
    assert.equal(f.urls.length, 0)
  })
})
