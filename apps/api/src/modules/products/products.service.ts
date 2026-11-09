import type { AuthUser } from '../../shared/auth.js'
import { type Db, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import * as repo from './products.repository.js'
import type { AdjustStockInput, CreateProductInput, ListProductsQuery, UpdateProductInput } from './products.schema.js'
import type { MerchantProductDTO, ProductDTO } from './products.types.js'

// A vitrine não enxerga o que é do comerciante (B2B, barcode, ativo, criação).
function toPublic({ active, barcode, allowB2bSharing, b2bReserveQty, createdAt, ...product }: MerchantProductDTO): ProductDTO {
  void active, barcode, allowB2bSharing, b2bReserveQty, createdAt
  return product
}

const notFound = () => new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.')

export function createProductsService(deps: { db: Db }) {
  const { db } = deps

  async function listPublic(query: ListProductsQuery): Promise<ProductDTO[]> {
    return (await repo.listProducts(db, query)).map(toPublic)
  }

  async function getPublic(id: string): Promise<ProductDTO> {
    const product = await repo.findPublicById(db, id)
    if (!product) throw notFound()
    return toPublic(product)
  }

  const listMine = (merchant: AuthUser, query: ListProductsQuery) => repo.listProducts(db, { ...query, ownerId: merchant.id })

  async function create(merchant: AuthUser, input: CreateProductInput): Promise<MerchantProductDTO> {
    return withTransaction(db, async (tx) => {
      const id = await repo.insertProduct(tx, merchant.id, input)
      await tx.query('SELECT refresh_clearance()') // validade próxima já nasce como oferta
      return (await repo.findOwnedById(tx, id, merchant.id))!
    })
  }

  async function update(merchant: AuthUser, id: string, input: UpdateProductInput): Promise<MerchantProductDTO> {
    return withTransaction(db, async (tx) => {
      if (!(await repo.updateProduct(tx, id, merchant.id, input))) throw notFound()
      await tx.query('SELECT refresh_clearance()')
      return (await repo.findOwnedById(tx, id, merchant.id, true))! // `active: false` ainda devolve o produto
    })
  }

  async function remove(merchant: AuthUser, id: string): Promise<void> {
    if (!(await repo.softDeleteProduct(db, id, merchant.id))) throw notFound()
  }

  async function adjustStock(merchant: AuthUser, id: string, input: AdjustStockInput): Promise<MerchantProductDTO> {
    const outcome = await repo.adjustStock(db, id, merchant.id, input)
    if (outcome === 'not_found') throw notFound()
    if (outcome === 'insufficient') {
      throw new AppError(422, 'INSUFFICIENT_STOCK', 'A saída é maior que o estoque disponível.')
    }
    return (await repo.findOwnedById(db, id, merchant.id))!
  }

  return { listPublic, getPublic, listMine, create, update, remove, adjustStock }
}

export type ProductsService = ReturnType<typeof createProductsService>
