import { Router } from 'express'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { requireRole } from '../../shared/auth.js'
import type { Db } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'

const createCategorySchema = z.object({ name: z.string().trim().min(2).max(80) })

// Módulo pequeno: SQL direto na rota (sem regra de negócio além da unicidade do nome).
export function categoriesRouter(db: Db, requireLogin: RequestHandler) {
  const router = Router()

  // Pública: departamentos da vitrine com a quantidade de produtos vendáveis hoje.
  router.get('/', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT c.id, c.name,
              count(p.id) FILTER (WHERE p.active AND (p.expiration_date IS NULL OR p.expiration_date >= current_date))::int AS "productCount"
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id
        GROUP BY c.id
        ORDER BY c.name`,
    )
    res.json(rows)
  })

  router.post('/', requireLogin, requireRole('MERCHANT'), async (req, res) => {
    const { name } = createCategorySchema.parse(req.body)
    const { rows } = await db.query(
      `INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id, name`,
      [name],
    )
    if (!rows[0]) throw new AppError(409, 'CATEGORY_EXISTS', 'Já existe uma categoria com este nome.')
    res.status(201).json({ ...rows[0], productCount: 0 })
  })

  return router
}
