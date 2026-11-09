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
export async function startTestEnv(_legacyPort?: number, opts: { firebase?: FirebaseVerifier; extractor?: DealExtractor } = {}): Promise<TestEnv> {
  const port = await freePort()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-pg-'))
  const pgServer = new EmbeddedPostgres({ databaseDir: dir, user: 'vh', password: 'vh', port, persistent: false })
  await pgServer.initialise()
  await pgServer.start()
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
  const { httpServer, io } = buildServer(env, db, { firebase: opts.firebase, extractor: opts.extractor })
  await new Promise<void>((r) => httpServer.listen(0, r))
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
      io.close()
      await new Promise((r) => httpServer.close(r))
      await db.end()
      await stopPostgres(pgServer, dir)
    },
  }
}

// No Windows o stop() do Postgres embutido não é confiável: às vezes não retorna e deixa processos
// filhos órfãos segurando a porta (o próximo teste falha com "another postmaster already running").
// O banco é descartável, então derruba a árvore inteira de processos e apaga o diretório.
async function stopPostgres(server: EmbeddedPostgres, dir: string) {
  if (process.platform === 'win32') {
    const pid = Number(fs.readFileSync(path.join(dir, 'postmaster.pid'), 'utf8').split('\n')[0])
    if (pid) {
      // Se o postmaster morrer antes dos filhos (io_worker etc.), eles ficam órfãos e seguram a porta:
      // por isso a lista de filhos é tirada ANTES, e cada um é encerrado depois.
      const children = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`],
        { encoding: 'utf8' },
      ).stdout.split(/\s+/).filter(Boolean)
      for (const p of [String(pid), ...children]) spawnSync('taskkill', ['/PID', p, '/T', '/F'], { stdio: 'ignore' })
    }
  } else {
    await server.stop()
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    /* diretório temporário: o SO limpa depois */
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
