import type { AuthUser } from '../../shared/auth.js'
import { type Db, type DbClient, fromCents, toCents, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import type { OrderEvents } from '../../shared/realtime.js'
import { loadSettings } from '../stores/stores.service.js'
import * as repo from './orders.repository.js'
import type { CreateOrderInput, ListOrdersQuery, PosSaleInput } from './orders.schema.js'
import type { OrderDTO, OrderStatus } from './orders.types.js'

// Máquina de estados do pedido (docs/05-modelagem-de-dados.md).
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['IN_PREPARATION', 'CANCELLED'],
  IN_PREPARATION: ['READY', 'CANCELLED'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
}

const orderNotFound = () => new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')

export function createOrdersService(deps: { db: Db; events: OrderEvents }) {
  const { db, events } = deps

  // Mesmo produto repetido no carrinho vira uma linha só.
  function mergeLines(items: { productId: string; quantity: number }[]) {
    const wanted = new Map<string, number>()
    for (const { productId, quantity } of items) wanted.set(productId, (wanted.get(productId) ?? 0) + quantity)
    return wanted
  }

  // Carrega e valida o carrinho: existe, está vendável e é de um único mercadinho.
  async function loadCart(tx: DbClient, wanted: Map<string, number>) {
    const ids = [...wanted.keys()]
    const products = await repo.findProductsForOrder(tx, ids)
    const byId = new Map(products.map((p) => [p.id, p]))

    const missing = ids.filter((id) => !byId.has(id))
    if (missing.length) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.', { productIds: missing })

    const unavailable = products.filter((p) => !p.sellable).map((p) => p.id)
    if (unavailable.length) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'Produto indisponível.', { productIds: unavailable })

    if (new Set(products.map((p) => p.merchant_id)).size > 1) {
      throw new AppError(422, 'MULTIPLE_MERCHANTS', 'Um pedido só pode ter produtos de um mesmo mercadinho.')
    }
    const totalCents = products.reduce((sum, p) => sum + toCents(p.unit_price) * wanted.get(p.id)!, 0)
    return { products, merchantId: products[0]!.merchant_id, total: fromCents(totalCents).toFixed(2) }
  }

  const toLines = (wanted: Map<string, number>) => [...wanted].map(([productId, quantity]) => ({ productId, quantity }))

  async function reserveStock(tx: DbClient, lines: repo.StockLine[]) {
    const shortages = await repo.decrementStock(tx, lines)
    if (shortages.length) throw new AppError(422, 'INSUFFICIENT_STOCK', 'Estoque insuficiente.', { shortages })
  }

  // Regras configuradas pela loja (Configurações): entrega/retirada, pedido mínimo e formas de pagamento.
  async function checkStoreRules(tx: DbClient, merchantId: string, total: string, input: CreateOrderInput) {
    const { delivery, payments } = await loadSettings(tx, merchantId)
    const wantsDelivery = /entrega/i.test(input.deliveryMethod ?? '')
    if (wantsDelivery && !delivery.deliveryEnabled) {
      throw new AppError(422, 'DELIVERY_UNAVAILABLE', 'Esta loja não está fazendo entregas. Escolha retirar na loja.')
    }
    if (!wantsDelivery && !delivery.pickupEnabled) {
      throw new AppError(422, 'PICKUP_UNAVAILABLE', 'Esta loja não aceita retirada. Escolha entrega no bairro.')
    }
    if (wantsDelivery && toCents(total) < toCents(delivery.minOrder)) {
      throw new AppError(422, 'BELOW_MINIMUM', `Pedido mínimo para entrega: R$ ${delivery.minOrder.toFixed(2).replace('.', ',')}.`, { minOrder: delivery.minOrder })
    }
    if (input.paymentMethod && !payments[input.paymentMethod]) {
      throw new AppError(422, 'PAYMENT_UNAVAILABLE', 'Esta loja não aceita essa forma de pagamento.')
    }
  }

  /**
   * Cria um pedido PENDING para um único mercadinho.
   * O estoque é conferido aqui, mas só é baixado (de forma atômica) quando o
   * comerciante aceita o pedido no Kanban — evita "segurar" estoque de pedidos abandonados.
   */
  async function createOrder(customer: AuthUser, input: CreateOrderInput): Promise<OrderDTO> {
    const wanted = mergeLines(input.items)

    const order = await withTransaction(db, async (tx) => {
      const cart = await loadCart(tx, wanted)

      const shortages = cart.products
        .filter((p) => wanted.get(p.id)! > p.stock_qty)
        .map((p) => ({ productId: p.id, requested: wanted.get(p.id)!, available: p.stock_qty }))
      if (shortages.length) throw new AppError(422, 'INSUFFICIENT_STOCK', 'Estoque insuficiente.', { shortages })

      await checkStoreRules(tx, cart.merchantId, cart.total, input)

      const orderId = await repo.insertOrder(tx, {
        customerId: customer.id,
        merchantId: cart.merchantId,
        totalPrice: cart.total,
        contact: {
          name: input.customerName,
          phone: input.phone,
          deliveryMethod: input.deliveryMethod,
          deliveryAddress: input.deliveryAddress,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
        },
      })
      await repo.insertOrderItems(
        tx,
        orderId,
        cart.products.map((p) => ({ productId: p.id, quantity: wanted.get(p.id)!, unitPrice: p.unit_price })),
      )
      return (await repo.findOrderById(tx, orderId))!
    })

    // Só depois do COMMIT: o painel nunca recebe um pedido que não existe no banco.
    publish(() => events.orderCreated(order), 'order:created')
    return order
  }

  /**
   * Venda de balcão (Modo PDV): nasce COMPLETED e baixa o estoque na mesma transação.
   * Só vende produtos da própria loja.
   */
  async function createPosSale(merchant: AuthUser, input: PosSaleInput): Promise<OrderDTO> {
    const wanted = mergeLines(input.items)

    return withTransaction(db, async (tx) => {
      const cart = await loadCart(tx, wanted)
      if (cart.merchantId !== merchant.id) {
        throw new AppError(422, 'FOREIGN_PRODUCT', 'Só é possível vender produtos da própria loja.')
      }
      await reserveStock(tx, toLines(wanted))

      const orderId = await repo.insertOrder(tx, {
        customerId: null,
        merchantId: merchant.id,
        totalPrice: cart.total,
        channel: 'POS',
        status: 'COMPLETED',
      })
      await repo.insertOrderItems(
        tx,
        orderId,
        cart.products.map((p) => ({ productId: p.id, quantity: wanted.get(p.id)!, unitPrice: p.unit_price })),
      )
      return (await repo.findOrderById(tx, orderId))!
    })
  }

  /**
   * Kanban: avança (ou cancela) o pedido.
   *  - PENDING → IN_PREPARATION baixa o estoque de forma atômica (falta → 422 e nada muda).
   *  - IN_PREPARATION → CANCELLED devolve o estoque que havia sido baixado.
   *  - Transição fora do mapa → 409.
   */
  async function updateStatus(merchant: AuthUser, orderId: string, next: OrderStatus): Promise<OrderDTO> {
    const order = await withTransaction(db, async (tx) => {
      const current = await repo.lockOrder(tx, orderId)
      // Pedido de outra loja é "não encontrado" (não revela que existe).
      if (!current || current.merchant_id !== merchant.id) throw orderNotFound()

      const allowed = TRANSITIONS[current.status]
      if (!allowed.includes(next)) {
        throw new AppError(409, 'INVALID_TRANSITION', `Não é possível mudar de ${current.status} para ${next}.`, {
          from: current.status,
          to: next,
          allowed,
        })
      }

      if (next === 'IN_PREPARATION') {
        await reserveStock(tx, await repo.listOrderLines(tx, orderId))
      } else if (next === 'CANCELLED' && current.status === 'IN_PREPARATION') {
        await repo.restoreStock(tx, await repo.listOrderLines(tx, orderId))
      }

      await repo.setStatus(tx, orderId, next)
      return (await repo.findOrderById(tx, orderId))!
    })

    publish(() => events.orderStatusUpdated(order), 'order:status_updated')
    return order
  }

  function listOrders(user: AuthUser, query: Partial<ListOrdersQuery>) {
    return user.role === 'MERCHANT'
      ? repo.listOrders(db, { ...query, merchantId: user.id })
      : repo.listOrders(db, { ...query, customerId: user.id })
  }

  // Comerciante vê pedidos da própria loja; cliente, os próprios. Qualquer outro caso é 404.
  async function getOrder(user: AuthUser, id: string): Promise<OrderDTO> {
    const order = await repo.findOrderById(db, id)
    const mine = user.role === 'MERCHANT' ? order?.merchantId === user.id : order?.customer?.id === user.id
    if (!order || !mine) throw orderNotFound()
    return order
  }

  return { createOrder, createPosSale, updateStatus, listOrders, getOrder }
}

// Falha ao avisar via WebSocket nunca desfaz nem falha um pedido já gravado.
function publish(emit: () => void, name: string) {
  try {
    emit()
  } catch (err) {
    console.error(`Falha ao publicar ${name}`, err)
  }
}

export type OrdersService = ReturnType<typeof createOrdersService>
