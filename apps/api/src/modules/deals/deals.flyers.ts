import { z } from 'zod'
import type { AuthUser } from '../../shared/auth.js'
import { type Db, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import type { DealExtractor, FlyerFile } from './deals.extractor.js'
import { saveDeals } from './deals.scanner.js'

export const MAX_FLYER_BYTES = 20 * 1024 * 1024 // PDF; o limite da API do Claude é 32 MB por requisição
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // limite da API do Claude por imagem
const MAX_IN_FLIGHT = 3 // leituras simultâneas: cada uma é uma chamada cara ao modelo


export const uploadFlyerQuerySchema = z.object({
  chain: z.string().trim().min(1).max(40), // slug da rede
  neighborhood: z.string().trim().min(1).max(80).optional(),
  validDays: z.coerce.number().int().min(1).max(30).default(7), // validade do encarte
  // Encarte de várias páginas/fotos: envie cada uma com append=true para não apagar as ofertas das anteriores.
  append: z.enum(['true', 'false']).transform((v) => v === 'true').default(false),
  fileName: z.string().trim().max(200).optional(),
})
export type UploadFlyerQuery = z.infer<typeof uploadFlyerQuerySchema>

export interface FlyerUploadDTO {
  id: string
  chain: { slug: string; name: string }
  neighborhood: string | null
  fileName: string | null
  mediaType: string
  sizeBytes: number
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED'
  itemsExtracted: number
  itemsDropped: number
  error: string | null
  createdAt: string
  finishedAt: string | null
}

// O Content-Type do cliente não é confiável: o tipo vem dos primeiros bytes do arquivo.
export function sniffMediaType(b: Buffer): FlyerFile['mediaType'] | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (b.length > 12 && b.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf'
  return null
}

const UPLOAD_SQL = `
  SELECT f.id, json_build_object('slug', c.slug, 'name', c.name) AS chain, f.neighborhood,
         f.file_name AS "fileName", f.media_type AS "mediaType", f.size_bytes AS "sizeBytes", f.status,
         f.items_extracted AS "itemsExtracted", f.items_dropped AS "itemsDropped", f.error,
         to_char(f.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
         to_char(f.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "finishedAt"
    FROM flyer_uploads f
    JOIN retail_chains c ON c.id = f.chain_id`

export function createFlyersService(deps: { db: Db; extract?: DealExtractor; log?: (message: string) => void }) {
  const { db, extract, log = console.error } = deps
  const inFlight = new Set<Promise<void>>()

  const find = async (id: string) => (await db.query<FlyerUploadDTO>(`${UPLOAD_SQL} WHERE f.id = $1`, [id])).rows[0]!

  async function processFlyer(
    uploadId: string,
    source: { id: number; chainId: number; neighborhood: string | null },
    chainName: string,
    file: FlyerFile,
    opts: { validDays: number; append: boolean },
  ) {
    const finish = (status: 'SUCCESS' | 'FAILED', items: number, dropped: number, error: string | null) =>
      db.query(`UPDATE flyer_uploads SET status = $2, items_extracted = $3, items_dropped = $4, error = $5, finished_at = now() WHERE id = $1`, [
        uploadId, status, items, dropped, error,
      ])
    try {
      const result = await extract!({ chainName, neighborhood: source.neighborhood, content: '', file })
      if (result.deals.length === 0) {
        await finish('FAILED', 0, result.dropped, 'Nenhuma oferta encontrada no arquivo. Envie uma foto mais nítida ou o PDF do encarte.')
        return
      }
      const validUntil = new Date(Date.now() + opts.validDays * 86_400_000)
      const saved = await withTransaction(db, async (tx) => {
        const count = await saveDeals(tx, source, result, { validUntil, deactivateUnseen: !opts.append })
        await tx.query(
          `UPDATE flyer_uploads SET status = 'SUCCESS', items_extracted = $2, items_dropped = $3, finished_at = now() WHERE id = $1`,
          [uploadId, count, result.dropped],
        )
        return count
      })
      log(`Encarte ${uploadId} (${chainName}): ${saved} oferta(s)`)
    } catch (err) {
      log(`Encarte ${uploadId}: ${err instanceof Error ? err.message : String(err)}`)
      await finish('FAILED', 0, 0, 'Não foi possível ler o encarte. Tente novamente em instantes.').catch(() => {})
    }
  }

  // Valida, registra o envio e devolve na hora: a leitura pelo modelo leva de segundos a minutos e roda em segundo plano.
  async function upload(user: AuthUser, query: UploadFlyerQuery, data: Buffer): Promise<FlyerUploadDTO> {
    if (!extract) throw new AppError(501, 'FLYERS_DISABLED', 'A leitura de encartes não está configurada (ANTHROPIC_API_KEY).')
    const mediaType = sniffMediaType(data)
    if (!mediaType) throw new AppError(415, 'UNSUPPORTED_FILE', 'Envie o encarte como PDF, JPEG, PNG ou WebP.')
    if (mediaType !== 'application/pdf' && data.length > MAX_IMAGE_BYTES) {
      throw new AppError(413, 'FILE_TOO_LARGE', 'Imagens podem ter no máximo 5 MB. Reduza a foto ou envie o PDF.')
    }

    const chain = (
      await db.query<{ id: number; name: string; slug: string; manager: boolean }>(
        `SELECT c.id, c.name, c.slug,
                EXISTS (SELECT 1 FROM retail_chain_managers m WHERE m.chain_id = c.id AND m.user_id = $2) AS manager
           FROM retail_chains c WHERE c.slug = $1 AND c.active`,
        [query.chain, user.id],
      )
    ).rows[0]
    if (!chain) throw new AppError(404, 'CHAIN_NOT_FOUND', 'Rede não encontrada.')
    if (!chain.manager) throw new AppError(403, 'NOT_CHAIN_MANAGER', 'Você não está autorizado a enviar encartes desta rede.')
    if (inFlight.size >= MAX_IN_FLIGHT) throw new AppError(429, 'FLYER_QUEUE_FULL', 'Há encartes demais sendo lidos agora. Tente em um minuto.')

    const neighborhood = query.neighborhood ?? null
    // Uma fonte por rede+bairro: o encarte novo substitui o anterior.
    const { rows: src } = await db.query<{ id: number }>(
      `INSERT INTO deal_sources (chain_id, url, neighborhood, kind) VALUES ($1, $2, $3, 'FLYER')
       ON CONFLICT (url) DO UPDATE SET last_scanned_at = now() RETURNING id`,
      [chain.id, `flyer:${chain.slug}:${(neighborhood ?? '*').toLowerCase()}`, neighborhood],
    )
    const source = { id: src[0]!.id, chainId: chain.id, neighborhood }
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO flyer_uploads (chain_id, uploader_id, source_id, neighborhood, file_name, media_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [chain.id, user.id, source.id, neighborhood, query.fileName ?? null, mediaType, data.length],
    )
    const id = rows[0]!.id

    const job = processFlyer(id, source, chain.name, { mediaType, data }, query).finally(() => inFlight.delete(job))
    inFlight.add(job)
    return find(id)
  }

  const listMine = async (user: AuthUser): Promise<FlyerUploadDTO[]> =>
    (await db.query<FlyerUploadDTO>(`${UPLOAD_SQL} WHERE f.uploader_id = $1 ORDER BY f.created_at DESC LIMIT 20`, [user.id])).rows

  async function getMine(user: AuthUser, id: string): Promise<FlyerUploadDTO> {
    const row = (await db.query<FlyerUploadDTO>(`${UPLOAD_SQL} WHERE f.id = $1 AND f.uploader_id = $2`, [id, user.id])).rows[0]
    if (!row) throw new AppError(404, 'FLYER_NOT_FOUND', 'Envio não encontrado.')
    return row
  }

  /** Espera as leituras em andamento (encerramento limpo e testes). */
  const idle = async () => void (await Promise.allSettled([...inFlight]))

  return { upload, listMine, getMine, idle }
}

export type FlyersService = ReturnType<typeof createFlyersService>
