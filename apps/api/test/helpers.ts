// Ambiente de teste: Postgres de verdade (embutido) com schema + seed, API em porta aleatória.
// Cada arquivo de teste usa a própria porta do Postgres (os arquivos rodam em paralelo).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net, { type AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { io as connect, type Socket } from 'socket.io-client'
import { buildServer } from '../src/app.js'
import { signToken } from '../src/shared/auth.js'
import { createPool, type Db } from '../src/shared/db.js'
import { loadEnv } from '../src/shared/env.js'
import type { Router } from '../src/modules/branches/routing.js'
import type { DealExtractor } from '../src/modules/deals/deals.extractor.js'
import type { FirebaseVerifier } from '../src/shared/firebase.js'

const ROOT = path.resolve(import.meta.dirname, '../../..')
export const SECRET = 'test-secret-with-enough-length'

// IDs do db/seed.sql
export const ZE = '11111111-1111-4111-8111-111111111111'
export const LUCIA = '22222222-2222-4222-8222-222222222222'
export const MARIA = '33333333-3333-4333-8333-333333333333'
export const CREME = 'aaaaaaaa-0000-4000-8000-000000000001' // Zé · R$ 4,29 · 24 un
export const IOGURTE = 'aaaaaaaa-0000-4000-8000-000000000002' // Zé · 30% OFF → R$ 2,72
export const ARROZ_ZE = 'aaaaaaaa-0000-4000-8000-000000000003' // Zé · esgotado · B2B
export const PAO = 'aaaaaaaa-0000-4000-8000-000000000004' // Zé · 5 un · 50% OFF
export const ARROZ_LUCIA = 'bbbbbbbb-0000-4000-8000-000000000001' // Lúcia · 30 un · reserva 5
export const SUCO_LUCIA = 'bbbbbbbb-0000-4000-8000-000000000002'

export const tokenFor = (id: string) => signToken(id, SECRET)

export interface TestEnv {
  db: Db
  baseUrl: string
  /** fetch JSON: devolve status + corpo já parseado. */
  api(method: string, url: string, opts?: { token?: string; body?: unknown }): Promise<{ status: number; body: any }>
  socketFor(userId: string): Promise<Socket>
  stop(): Promise<void>
}

// Porta livre para o Postgres de teste, pedida ao SO (porta 0). Portas fixas faziam duas execuções da suíte
// ao mesmo tempo (duas sessões, CI + máquina local) ou um Postgres órfão derrubarem os testes.
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

/** O argumento é ignorado (mantido só por compatibilidade com quem ainda passa uma porta fixa). */
export async function startTestEnv(_legacyPort?: number, opts: { firebase?: FirebaseVerifier; extractor?: DealExtractor; router?: Router } = {}): Promise<TestEnv> {
  cleanupOldDirs()
  const port = await freePort()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-pg-'))
  const inst: PgInstance = { dir, pids: new Set() }
  instances.add(inst)
  installExitHooks()
  const pgServer = new EmbeddedPostgres({ databaseDir: dir, user: 'vh', password: 'vh', port, persistent: false })
  await pgServer.initialise()
  await pgServer.start()
  if (process.platform === 'win32') for (const p of snapshotPids(dir)) inst.pids.add(p)
  // Banco UTF-8 independente da codificação padrão do Windows.
  const admin = new pg.Client({ connectionString: `postgresql://vh:vh@localhost:${port}/postgres` })
  await admin.connect()
  await admin.query(`CREATE DATABASE vh ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`)
  await admin.end()

  const url = `postgresql://vh:vh@localhost:${port}/vh`
  const db = createPool(url)
  await db.query(fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'))
  await db.query(fs.readFileSync(path.join(ROOT, 'db/seed.sql'), 'utf8'))

  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: SECRET })
  const { httpServer, io, catalogLive } = buildServer(env, db, { firebase: opts.firebase, extractor: opts.extractor, router: opts.router })
  await new Promise<void>((r) => httpServer.listen(0, r))
  await catalogLive.ready // LISTEN do catálogo já ativo: nenhuma mudança feita pelo teste se perde
  const baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`

  return {
    db,
    baseUrl,
    async api(method, route, { token, body } = {}) {
      const res = await fetch(`${baseUrl}${route}`, {
        method,
        headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : undefined }
    },
    socketFor: (userId) =>
      new Promise((resolve, reject) => {
        const s = connect(baseUrl, { auth: { token: tokenFor(userId) }, transports: ['websocket'] })
        s.on('connect', () => resolve(s))
        s.on('connect_error', reject)
      }),
    async stop() {
      await catalogLive.stop()
      io.close()
      await new Promise((r) => httpServer.close(r))
      await db.end()
      await stopPostgres(pgServer, inst)
    },
  }
}

// ---- Encerramento do Postgres embutido -------------------------------------------------------------
// No Windows o stop() do Postgres embutido não é confiável: às vezes não retorna e deixa processos
// filhos órfãos (io_worker etc.) segurando a porta e CPU. Estratégia: (1) pg_ctl stop -m immediate, para o
// postmaster encerrar os próprios filhos; (2) fallback à força, só nos PIDs DESTA instância (nunca em outros
// postgres.exe, como o banco de desenvolvimento em apps/api/.pgdata).
interface PgInstance {
  dir: string
  pids: Set<number>
}
const instances = new Set<PgInstance>()
let exitHooksInstalled = false

function pgCtlPath(): string | null {
  const rel = '@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'
  for (const base of [path.resolve(import.meta.dirname, '../node_modules'), path.join(ROOT, 'node_modules')]) {
    const candidate = path.join(base, rel)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function postmasterPid(dir: string): number {
  try {
    return Number(fs.readFileSync(path.join(dir, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0]) || 0
  } catch {
    return 0
  }
}

/** Postmaster + filhos diretos desta instância (Windows). Vazio se o postmaster já não existe. */
function snapshotPids(dir: string): number[] {
  const pid = postmasterPid(dir)
  if (!pid) return []
  const out = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`],
    { encoding: 'utf8' },
  ).stdout
  return [pid, ...out.split(/\s+/).filter(Boolean).map(Number)].filter((n) => Number.isInteger(n) && n > 0)
}

/** Mata, de forma síncrona, só os PIDs informados que ainda sejam postgres.exe (evita PID reaproveitado). */
function killPids(pids: Iterable<number>) {
  const list = [...pids]
  if (list.length === 0) return
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-Process -Name postgres -ErrorAction SilentlyContinue | Where-Object { @(${list.join(',')}) -contains $_.Id } | Stop-Process -Force -ErrorAction SilentlyContinue`,
    ],
    { stdio: 'ignore' },
  )
}

/** Desligamento ordenado + fallback forçado, tudo síncrono (serve também para os handlers de saída). */
function shutdownInstance(inst: PgInstance) {
  for (const p of snapshotPids(inst.dir)) inst.pids.add(p)
  const ctl = pgCtlPath()
  if (ctl) spawnSync(ctl, ['stop', '-D', inst.dir, '-m', 'immediate', '-w', '-t', '10'], { stdio: 'ignore' })
  killPids(inst.pids)
  try {
    fs.rmSync(inst.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    /* diretório temporário: o SO limpa depois */
  }
  instances.delete(inst)
}

function installExitHooks() {
  if (exitHooksInstalled || process.platform !== 'win32') return
  exitHooksInstalled = true
  const cleanup = () => {
    for (const inst of [...instances]) shutdownInstance(inst)
  }
  process.on('exit', cleanup)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.on(sig, () => {
      cleanup()
      process.exit(130)
    })
  }
}

/** Apaga diretórios vh-pg-* com mais de 1 dia, exceto os que tenham um postmaster vivo. */
function cleanupOldDirs() {
  const limit = Date.now() - 24 * 60 * 60 * 1000
  let names: string[] = []
  try {
    names = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('vh-pg-'))
  } catch {
    return
  }
  for (const name of names) {
    const d = path.join(os.tmpdir(), name)
    try {
      if (fs.statSync(d).mtimeMs > limit) continue
      const pid = postmasterPid(d)
      if (pid) {
        try {
          process.kill(pid, 0) // lança se o processo não existe
          continue
        } catch {
          /* morto: pode apagar */
        }
      }
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignora */
    }
  }
}

async function stopPostgres(server: EmbeddedPostgres, inst: PgInstance) {
  if (process.platform === 'win32') {
    shutdownInstance(inst)
  } else {
    await server.stop()
    instances.delete(inst)
    try {
      fs.rmSync(inst.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      /* diretório temporário */
    }
  }
}

export const nextEvent =<T>(s: Socket, event: string, ms = 2000) =>
  new Promise<T | null>((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    s.once(event, (payload: T) => {
      clearTimeout(t)
      resolve(payload)
    })
  })
