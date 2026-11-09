import { Router } from 'express'
import type { RequestHandler } from 'express'
import { requireRole } from '../../shared/auth.js'
import {
  adjustStockSchema,
  createProductSchema,
  idParamSchema,
  listProductsSchema,
  updateProductSchema,
} from './products.schema.js'
import type { ProductsService } from './products.service.js'

export function productsRouter(service: ProductsService, requireLogin: RequestHandler) {
  const router = Router()
  const merchantOnly = [requireLogin, requireRole('MERCHANT')]

  // Vitrine pública: só o que é vendável hoje, já com o preço final do Salva-Estoque.
  router.get('/', async (req, res) => {
    res.json(await service.listPublic(listProductsSchema.parse(req.query)))
  })

  // Painel do comerciante: todos os produtos ativos da loja (inclui esgotados e vencidos).
  router.get('/mine', ...merchantOnly, async (req, res) => {
    res.json(await service.listMine(req.user!, listProductsSchema.parse(req.query)))
  })

  router.get('/:id', async (req, res) => {
    res.json(await service.getPublic(idParamSchema.parse(req.params).id))
  })

  router.post('/', ...merchantOnly, async (req, res) => {
    res.status(201).json(await service.create(req.user!, createProductSchema.parse(req.body)))
  })

  router.put('/:id', ...merchantOnly, async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    res.json(await service.update(req.user!, id, updateProductSchema.parse(req.body)))
  })

  // Entrada/saída rápida: { "delta": -3 } ou contagem { "set": 40 }. Saída > saldo → 422.
  router.patch('/:id/stock', ...merchantOnly, async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    res.json(await service.adjustStock(req.user!, id, adjustStockSchema.parse(req.body)))
  })

  // Remoção lógica: o histórico de pedidos continua apontando para o produto.
  router.delete('/:id', ...merchantOnly, async (req, res) => {
    await service.remove(req.user!, idParamSchema.parse(req.params).id)
    res.status(204).end()
  })

  return router
}
