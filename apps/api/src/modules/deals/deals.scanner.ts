import { createHash } from 'node:crypto'
import { type Db, type DbClient, withTransaction } from '../../shared/db.js'
import type { DealExtractor } from './deals.extractor.js'
import type { PageFetcher } from './deals.fetcher.js'
import type { ExtractionResult } from './deals.types.js'

// Trava de aplicação: com várias instâncias da API, só uma varre por vez.
const SCAN_LOCK = 7_301_001

interface SourceRow {
  id: number
  chainId: number
  chainName: string
  url: string
  kind: 'HTML' | 'TEXT'
  neighborhood: string | null
  contentHash: string | null
  lastStatus: string | null
}

export interface ScanSummary {
  skipped: boolean // outra instância já está varrendo
  sources: number
  ok: number
  unchanged: number
  empty: number
  failed: number
  deals: number
}

export interface ScanDeps {
  db: Db
  fetchPage: PageFetcher
  extract: DealExtractor
  log?: (message: string) => void
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

async function loadSources(db: Db): Promise<SourceRow[]> {
  const { rows } = await db.query<SourceRow>(
    `SELECT s.id, s.chain_id AS "chainId", c.name AS "chainName", s.url, s.kind, s.neighborhood,
            s.content_hash AS "contentHash", s.last_status AS "lastStatus"
       FROM deal_sources s
       JOIN retail_chains c ON c.id = s.chain_id
      WHERE s.active AND c.active AND s.kind <> 'FLYER' -- encarte enviado não tem página para buscar
      ORDER BY s.last_scanned_at NULLS FIRST, s.id`,
  )
  return rows
}

export interface SaveOptions {
  validUntil?: Date | null // encarte enviado: até quando as ofertas valem
  deactivateUnseen?: boolean // false = o arquivo é só mais uma página do mesmo encarte
}

// Grava as ofertas lidas e (por padrão) desativa as que a fonte deixou de mostrar.
export async function saveDeals(
  tx: DbClient,
  source: Pick<SourceRow, 'id' | 'chainId' | 'neighborhood'>,
  result: ExtractionResult,
  { validUntil = null, deactivateUnseen = true }: SaveOptions = {},
): Promise<number> {
  const neighborhood = source.neighborhood ?? result.neighborhood
  const seen: string[] = []
  for (const d of result.deals) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO deals (chain_id, source_id, neighborhood, product_name, category, brand, unit, wholesale_min_qty,
                          original_price, discount_price, discount_pct, is_flash_deal, coupon_eligible, delivery_eligible, raw_offer_text, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (source_id, lower(product_name), wholesale_min_qty) DO UPDATE SET
         neighborhood = EXCLUDED.neighborhood, category = EXCLUDED.category, brand = EXCLUDED.brand, unit = EXCLUDED.unit,
         original_price = EXCLUDED.original_price, discount_price = EXCLUDED.discount_price, discount_pct = EXCLUDED.discount_pct,
         is_flash_deal = EXCLUDED.is_flash_deal, coupon_eligible = EXCLUDED.coupon_eligible,
         delivery_eligible = EXCLUDED.delivery_eligible, raw_offer_text = EXCLUDED.raw_offer_text,
         valid_until = EXCLUDED.valid_until, last_seen_at = now(), active = TRUE
       RETURNING id`,
      [source.chainId, source.id, neighborhood, d.productName, d.category, d.brand, d.unit, d.wholesaleMinQty,
       d.originalPrice, d.discountPrice, d.discountPct, d.isFlashDeal, d.couponEligible, d.deliveryEligible, d.rawOfferText, validUntil],
    )
    seen.push(rows[0]!.id)
  }
  if (deactivateUnseen) {
    await tx.query(`UPDATE deals SET active = FALSE WHERE source_id = $1 AND active AND NOT (id = ANY($2::uuid[]))`, [source.id, seen])
  }
  return seen.length
}

const markSource = (db: Db | DbClient, id: number, status: 'OK' | 'UNCHANGED' | 'EMPTY' | 'ERROR', hash: string | null, error: string | null) =>
  db.query(
    `UPDATE deal_sources
        SET last_scanned_at = now(), last_status = $2::varchar, last_error = $4,
            content_hash = CASE WHEN $2::varchar IN ('OK', 'UNCHANGED') THEN $3::char(64) ELSE content_hash END
      WHERE id = $1`,
    [id, status, hash, error],
  )

// Uma varredura completa: lê cada fonte ativa, extrai e grava. Falha numa fonte não para as outras.
export async function runDealsScan({ db, fetchPage, extract, log = () => {} }: ScanDeps): Promise<ScanSummary> {
  const summary: ScanSummary = { skipped: false, sources: 0, ok: 0, unchanged: 0, empty: 0, failed: 0, deals: 0 }

  const lock = await db.connect()
  try {
    const { rows } = await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [SCAN_LOCK])
    if (!rows[0]!.locked) return { ...summary, skipped: true }

    const sources = await loadSources(db)
    summary.sources = sources.length
    for (const source of sources) {
      try {
        const content = await fetchPage(source.url, source.kind)
        const hash = sha256(content)

        // Página idêntica à da última leitura: as ofertas continuam valendo e o modelo nem é chamado.
        if (hash === source.contentHash && source.lastStatus !== 'ERROR') {
          await withTransaction(db, async (tx) => {
            await tx.query('UPDATE deals SET last_seen_at = now() WHERE source_id = $1 AND active', [source.id])
            await markSource(tx, source.id, 'UNCHANGED', hash, null)
          })
          summary.unchanged++
          continue
        }

        const result = await extract({ chainName: source.chainName, neighborhood: source.neighborhood, content })
        if (result.deals.length === 0) {
          // Página sem nenhuma oferta é mais provável layout quebrado que promoção zero: não apaga o que já existe
          // (as ofertas envelhecem sozinhas pelo last_seen_at) e tenta de novo na próxima rodada.
          await markSource(db, source.id, 'EMPTY', null, null)
          summary.empty++
          continue
        }

        const saved = await withTransaction(db, async (tx) => {
          const count = await saveDeals(tx, source, result)
          await markSource(tx, source.id, 'OK', hash, null)
          return count
        })
        summary.ok++
        summary.deals += saved
        log(`${source.chainName}: ${saved} oferta(s)${result.dropped ? `, ${result.dropped} descartada(s)` : ''}`)
      } catch (err) {
        summary.failed++
        const message = err instanceof Error ? err.message : String(err)
        log(`${source.chainName} (${source.url}): ${message}`)
        await markSource(db, source.id, 'ERROR', null, message.slice(0, 500)).catch(() => {})
      }
    }
    return summary
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [SCAN_LOCK]).catch(() => {})
    lock.release()
  }
}
