import type { ComboDTO, CreateComboInput, DailyMenuItemDTO, SetDailyMenuInput } from '@vizinhohub/contracts/daily-menu'
import type { AuthUser } from '../../shared/auth.js'
import { type Db, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

const MENU_SQL = `
  SELECT d.id, d.merchant_id AS "merchantId", d.product_id AS "productId", p.name AS "productName",
         p.price::float8 AS price, p.image, d.menu_date::text AS "menuDate", d.is_on AS "isOn",
         d.qty_total AS "qtyTotal", d.qty_available AS "qtyAvailable",
         to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM daily_menu d JOIN products p ON p.id = d.product_id`

const COMBO_SQL = `
  SELECT p.id, p.user_id AS "merchantId", p.name, p.description, p.price::float8 AS price, p.image,
         COALESCE((SELECT json_agg(json_build_object('componentId', ci.component_id, 'name', c.name, 'quantity', ci.quantity) ORDER BY c.name)
                     FROM combo_items ci JOIN products c ON c.id = ci.component_id WHERE ci.combo_id = p.id), '[]'::json) AS components
    FROM products p`

export function createDailyMenuService(deps: { db: Db }) {
  const { db } = deps

  // ---- Prato do dia ---------------------------------------------------------------------------

  /** Vitrine: itens ligados da loja (os sem porções aparecem com qtyAvailable 0). Padrão: hoje. */
  async function listPublic(q: { merchantId?: string; date?: string }): Promise<DailyMenuItemDTO[]> {
    const { rows } = await db.query<DailyMenuItemDTO>(
      `${MENU_SQL} WHERE d.is_on AND p.active AND d.menu_date = COALESCE($2::date, current_date) AND ($1::uuid IS NULL OR d.merchant_id = $1)
       ORDER BY p.name`,
      [q.merchantId ?? null, q.date ?? null],
    )
    return rows
  }

  async function listMine(merchant: AuthUser, date?: string): Promise<DailyMenuItemDTO[]> {
    const { rows } = await db.query<DailyMenuItemDTO>(
      `${MENU_SQL} WHERE d.merchant_id = $1 AND d.menu_date = COALESCE($2::date, current_date) ORDER BY p.name`,
      [merchant.id, date ?? null],
    )
    return rows
  }

  /**
   * Põe um produto no cardápio de uma data. O produto vira DAILY_SPECIAL (o limite passa a ser o das
   * porções do dia). Reenviar o mesmo dia ajusta o total sem perder o que já foi vendido.
   */
  async function setMenu(merchant: AuthUser, input: SetDailyMenuInput): Promise<DailyMenuItemDTO> {
    return withTransaction(db, async (tx) => {
      const { rows: prod } = await tx.query<{ kind: string }>(`SELECT kind FROM products WHERE id = $1 AND user_id = $2 AND active FOR UPDATE`, [input.productId, merchant.id])
      if (!prod[0]) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')
      if (prod[0].kind === 'COMBO') throw new AppError(422, 'INVALID_PRODUCT_KIND', 'Combo não pode ser prato do dia.')
      if (prod[0].kind === 'ITEM') await tx.query(`UPDATE products SET kind = 'DAILY_SPECIAL' WHERE id = $1`, [input.productId])
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO daily_menu (merchant_id, product_id, menu_date, is_on, qty_total, qty_available)
         VALUES ($1, $2, COALESCE($3::date, current_date), $4, $5, $5)
         ON CONFLICT (product_id, menu_date) DO UPDATE
           SET is_on = EXCLUDED.is_on, qty_total = EXCLUDED.qty_total, updated_at = now(),
               qty_available = GREATEST(EXCLUDED.qty_total - (daily_menu.qty_total - daily_menu.qty_available), 0)
         RETURNING id`,
        [merchant.id, input.productId, input.menuDate ?? null, input.isOn, input.qtyTotal],
      )
      return (await fetchOne(tx, rows[0]!.id))!
    })
  }

  /** Liga/desliga e/ou muda o total do dia. As porções já vendidas continuam descontadas. */
  async function updateMenu(merchant: AuthUser, id: string, patch: { isOn?: boolean; qtyTotal?: number }): Promise<DailyMenuItemDTO> {
    const { rowCount } = await db.query(
      `UPDATE daily_menu SET is_on = COALESCE($3::boolean, is_on), qty_total = COALESCE($4::int, qty_total), updated_at = now(),
              qty_available = GREATEST(COALESCE($4::int, qty_total) - (qty_total - qty_available), 0)
        WHERE id = $1 AND merchant_id = $2`,
      [id, merchant.id, patch.isOn ?? null, patch.qtyTotal ?? null],
    )
    if (!rowCount) throw new AppError(404, 'MENU_ITEM_NOT_FOUND', 'Item do cardápio não encontrado.')
    return (await fetchOne(db, id))!
  }

  async function fetchOne(q: Pick<Db, 'query'>, id: string) {
    return (await q.query<DailyMenuItemDTO>(`${MENU_SQL} WHERE d.id = $1`, [id])).rows[0]
  }

  // ---- Combos ---------------------------------------------------------------------------------

  const listCombos = async (merchantId?: string): Promise<ComboDTO[]> =>
    (await db.query<ComboDTO>(`${COMBO_SQL} WHERE p.kind = 'COMBO' AND p.active AND ($1::uuid IS NULL OR p.user_id = $1) ORDER BY p.name`, [merchantId ?? null])).rows

  /**
   * Combo = produto kind COMBO + combo_items. Os componentes precisam ser itens comuns da própria loja.
   * Não há edição da composição (apague e crie outro): a composição vigente é a que vale.
   */
  async function createCombo(merchant: AuthUser, input: CreateComboInput): Promise<ComboDTO> {
    return withTransaction(db, async (tx) => {
      const ids = input.components.map((c) => c.componentId)
      const { rows: comps } = await tx.query<{ id: string }>(`SELECT id FROM products WHERE id = ANY($1::uuid[]) AND user_id = $2 AND active AND kind = 'ITEM'`, [ids, merchant.id])
      if (comps.length !== ids.length) throw new AppError(422, 'INVALID_COMPONENTS', 'Os componentes precisam ser produtos comuns e ativos da sua loja.')
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO products (user_id, category_id, name, description, price, unit, image, kind)
         VALUES ($1, $2, $3, $4, $5, 'Combo', $6, 'COMBO') RETURNING id`,
        [merchant.id, input.categoryId, input.name, input.description ?? null, input.price, input.image ?? null],
      )
      const comboId = rows[0]!.id
      await tx.query(
        `INSERT INTO combo_items (combo_id, component_id, quantity)
         SELECT $1, c, q FROM unnest($2::uuid[], $3::int[]) AS t(c, q)`,
        [comboId, ids, input.components.map((c) => c.quantity)],
      )
      return (await tx.query<ComboDTO>(`${COMBO_SQL} WHERE p.id = $1`, [comboId])).rows[0]!
    })
  }

  async function removeCombo(merchant: AuthUser, id: string): Promise<void> {
    const { rowCount } = await db.query(`UPDATE products SET active = FALSE WHERE id = $1 AND user_id = $2 AND kind = 'COMBO' AND active`, [id, merchant.id])
    if (!rowCount) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Combo não encontrado.')
  }

  return { listPublic, listMine, setMenu, updateMenu, listCombos, createCombo, removeCombo }
}

export type DailyMenuService = ReturnType<typeof createDailyMenuService>
