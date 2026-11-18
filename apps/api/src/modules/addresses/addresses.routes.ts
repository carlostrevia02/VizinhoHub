import { Router } from 'express'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { type Db, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(40),
  street: z.string().trim().min(3).max(160),
  neighborhood: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().length(2).toUpperCase().default('CE'),
  zip: z.string().trim().regex(/^\d{5}-?\d{3}$/, 'CEP inválido.').nullish(),
  isPrimary: z.boolean().default(false),
})
export const idSchema = z.object({ id: z.uuid() })
const MAX_ADDRESSES = 10

const COLUMNS = `id, label, street, neighborhood, city, state, zip, is_primary AS "isPrimary"`
const notFound = () => new AppError(404, 'ADDRESS_NOT_FOUND', 'Endereço não encontrado.')

// Endereços de entrega do usuário logado. SQL direto: a única regra é a do endereço "principal".
export function addressesRouter(db: Db, requireLogin: RequestHandler) {
  const router = Router()
  router.use(requireLogin)

  router.get('/', async (req, res) => {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM addresses WHERE user_id = $1 ORDER BY is_primary DESC, created_at`, [req.user!.id])
    res.json(rows)
  })

  router.post('/', async (req, res) => {
    const a = addressSchema.parse(req.body)
    const userId = req.user!.id
    const created = await withTransaction(db, async (tx) => {
      const { rows: count } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM addresses WHERE user_id = $1', [userId])
      if (count[0]!.n >= MAX_ADDRESSES) throw new AppError(422, 'TOO_MANY_ADDRESSES', `Máximo de ${MAX_ADDRESSES} endereços.`)
      // O 1º endereço já nasce principal; marcar outro como principal desmarca o anterior.
      const primary = a.isPrimary || count[0]!.n === 0
      if (primary) await tx.query('UPDATE addresses SET is_primary = FALSE WHERE user_id = $1', [userId])
      const { rows } = await tx.query(
        `INSERT INTO addresses (user_id, label, street, neighborhood, city, state, zip, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
        [userId, a.label, a.street, a.neighborhood, a.city, a.state, a.zip ?? null, primary],
      )
      return rows[0]
    })
    res.status(201).json(created)
  })

  router.put('/:id', async (req, res) => {
    const { id } = idSchema.parse(req.params)
    const a = addressSchema.parse(req.body)
    const userId = req.user!.id
    const updated = await withTransaction(db, async (tx) => {
      if (a.isPrimary) await tx.query('UPDATE addresses SET is_primary = FALSE WHERE user_id = $1 AND id <> $2', [userId, id])
      const { rows } = await tx.query(
        `UPDATE addresses SET label = $3, street = $4, neighborhood = $5, city = $6, state = $7, zip = $8, is_primary = $9
          WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
        [id, userId, a.label, a.street, a.neighborhood, a.city, a.state, a.zip ?? null, a.isPrimary],
      )
      if (!rows[0]) throw notFound()
      return rows[0]
    })
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = idSchema.parse(req.params)
    await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ is_primary: boolean }>('DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_primary', [id, req.user!.id])
      if (!rows[0]) throw notFound()
      // Apagou o principal: o endereço mais antigo assume.
      if (rows[0].is_primary) {
        await tx.query(
          `UPDATE addresses SET is_primary = TRUE
            WHERE id = (SELECT id FROM addresses WHERE user_id = $1 ORDER BY created_at LIMIT 1)`,
          [req.user!.id],
        )
      }
    })
    res.status(204).end()
  })

  return router
}
