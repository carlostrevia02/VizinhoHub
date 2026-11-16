import type { AuthUser } from '../../shared/auth.js'
import { type Db, type DbClient, fromCents, toCents, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import type { OrderEvents } from '../../shared/realtime.js'
import type { OpsService } from '../ops/ops.service.js'
import { claimOffers, releaseOffers, type FlashClaim } from '../flash/flash.claims.js'
import { quoteDelivery, saveOrderDelivery, type DeliveryQuote } from '../delivery/delivery.quote.js'
import { loadSettings } from '../stores/stores.service.js'
import { applyVipDiscount, recordVipSavings, vipFreeDelivery } from '../vip/vip.discount.js'
import { onOrderCancelled, onOrderPlaced } from './orders.extras.js'
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

export function createOrdersService(deps: { db: Db; events: OrderEvents; ops?: OpsService }) {
  const { db, events, ops } = deps

  // Mesmo produto repetido no carrinho vira uma linha só.
  function mergeLines(items: { productId: string; quantity: number }[]) {
    const wanted = new Map<string, number>()
    for (const { productId, quantity } of items) wanted.set(productId, (wanted.get(productId) ?? 0) + quantity)
    return wanted
  }

  // Carrega e valida o carrinho: existe, está vendável e é de um único mercadinho.
  // `claims` são as ofertas relâmpago já baixadas na transação: entram com o preço da oferta.
  async function loadCart(tx: DbClient, wanted: Map<string, number>, claims: FlashClaim[] = []) {
    const offerLines = new Map(claims.map((c) => [c.productId, c]))
    const clash = [...offerLines.keys()].filter((id) => wanted.has(id))
    if (clash.length) {
      // order_items tem UNIQUE (pedido, produto): o mesmo produto não pode entrar comum e em oferta.
      throw new AppError(422, 'FLASH_PRODUCT_CONFLICT', 'O mesmo produto não pode entrar no pedido ao preço normal e em oferta. Ajuste o carrinho.', { productIds: clash })
    }
    const ids = [...wanted.keys(), ...offerLines.keys()]
    const products = await repo.findProductsForOrder(tx, ids)
    const byId = new Map(products.map((p) => [p.id, p]))

    const missing = ids.filter((id) => !byId.has(id))
    if (missing.length) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.', { productIds: missing })

    const unavailable = products.filter((p) => !p.sellable).map((p) => p.id)
    if (unavailable.length) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'Produto indisponível.', { productIds: unavailable })

    if (new Set(products.map((p) => p.merchant_id)).size > 1) {
      throw new AppError(422, 'MULTIPLE_MERCHANTS', 'Um pedido só pode ter produtos de um mesmo mercadinho.')
    }
    const lines = products.map((p) => {
      const claim = offerLines.get(p.id)
      return claim
        ? { productId: p.id, quantity: claim.quantity, unitPrice: claim.unitPrice, flashOfferId: claim.offerId as string | null }
        : { productId: p.id, quantity: wanted.get(p.id)!, unitPrice: p.unit_price, flashOfferId: null as string | null }
    })
    const totalCents = lines.reduce((sum, l) => sum + toCents(l.unitPrice) * l.quantity, 0)
    return { products, lines, merchantId: products[0]!.merchant_id, total: fromCents(totalCents).toFixed(2) }
  }

  const toLines = (wanted: Map<string, number>) => [...wanted].map(([productId, quantity]) => ({ productId, quantity }))

  async function reserveStock(tx: DbClient, lines: repo.StockLine[], ctx: repo.StockContext = {}) {
    const shortages = await repo.decrementStock(tx, lines, ctx)
    if (shortages.length) throw new AppError(422, 'INSUFFICIENT_STOCK', 'Estoque insuficiente.', { shortages })
  }

  // Regras configuradas pela loja (Configurações): entrega/retirada, pedido mínimo e formas de pagamento.
  async function checkStoreRules(tx: DbClient, merchantId: string, total: string, input: CreateOrderInput, viaFulfillment = false) {
    const { delivery, payments } = await loadSettings(tx, merchantId)
    const wantsDelivery = viaFulfillment || /entrega/i.test(input.deliveryMethod ?? '')
    // Com `fulfillment: 'DELIVERY'` quem decide se a loja entrega é a config de logística (já validada em quoteDelivery).
    if (wantsDelivery && !viaFulfillment && !delivery.deliveryEnabled) {
      throw new AppError(422, 'DELIVERY_UNAVAILABLE', 'Esta loja não está fazendo entregas. Escolha retirar na loja.')
    }
    if (!wantsDelivery && !delivery.pickupEnabled) {
      throw new AppError(422, 'PICKUP_UNAVAILABLE', 'Esta loja não aceita retirada. Escolha entrega no bairro.')
    }
    if (wantsDelivery && toCents(total) < toCents(delivery.minOrder)) {
      throw new AppError(422, 'BELOW_MINIMUM', `Pedido mínimo para entrega: R$ ${delivery.minOrder.toFixed(2).replace('.', ',')}.`, { minOrder: delivery.minOrder })
    }
    // 'credit' (caderneta) não é configuração da loja: quem libera é ter conta ativa (conferido no lançamento).
    if (input.paymentMethod && input.paymentMethod !== 'credit' && !payments[input.paymentMethod]) {
      throw new AppError(422, 'PAYMENT_UNAVAILABLE', 'Esta loja não aceita essa forma de pagamento.')
    }
  }

  /**
   * Cria um pedido PENDING para um único mercadinho.
   * O estoque é conferido aqui, mas só é baixado (de forma atômica) quando o
   * comerciante aceita o pedido no Kanban — evita "segurar" estoque de pedidos abandonados.
   */
  async function createOrder(customer: AuthUser, input: CreateOrderInput): Promise<OrderDTO> {
    const wanted = mergeLines(input.items.filter((i): i is { productId: string; quantity: number } => !!i.productId))
    const offerItems = input.items.filter((i): i is { flashOfferId: string; quantity: number } => !!i.flashOfferId)

    let printJobId: string | null = null
    const order = await withTransaction(db, async (tx) => {
      // Ordem fixa (flash.claims.ts): 1) saldo da oferta  2) limite por cliente  3) estoque do produto.
      // 1 e 2 baixam na hora (atômico, voltam no ROLLBACK ou no cancelamento); 3 só é conferido aqui e
      // baixado no aceite do comerciante, como nos pedidos comuns.
      const claims = offerItems.length ? await claimOffers(tx, customer.id, offerItems) : []
      const cart = await loadCart(tx, wanted, claims)
      // --- Clube VIP: desconto direto no preço unitário (banca o lojista aderente; fora das ofertas relâmpago) ---
      const vip = await applyVipDiscount(tx, customer.id, cart.merchantId, cart.lines)
      cart.lines = vip.lines
      cart.total = vip.total
      // --- fim Clube VIP ---

      const stockById = new Map(cart.products.map((p) => [p.id, p.stock_qty]))
      const shortages = cart.lines
        .filter((l) => l.quantity > stockById.get(l.productId)!)
        .map((l) => ({ productId: l.productId, requested: l.quantity, available: stockById.get(l.productId)! }))
      if (shortages.length) throw new AppError(422, 'INSUFFICIENT_STOCK', 'Estoque insuficiente.', { shortages })

      // --- logística: início (taxa e raio da entrega; ver modules/delivery/delivery.quote.ts)
      let shipping: DeliveryQuote | null = null
      if (input.fulfillment === 'DELIVERY') shipping = await quoteDelivery(tx, cart.merchantId, { lat: input.deliveryLat, lng: input.deliveryLng })
      // Clube VIP: frete grátis custeado pela loja aderente (o raio continua valendo; só a taxa zera).
      if (shipping && (await vipFreeDelivery(tx, customer.id, cart.merchantId, cart.total))) shipping = { ...shipping, fee: '0.00' }
      // --- logística: fim
      await checkStoreRules(tx, cart.merchantId, cart.total, input, shipping !== null)

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
      await repo.insertOrderItems(tx, orderId, cart.lines)
      await recordVipSavings(tx, orderId, vip.savings) // Clube VIP
      if (shipping) await saveOrderDelivery(tx, orderId, shipping) // --- logística
      // [caderneta · encomendas · prato do dia] porções, agenda/vaga e fiado, na mesma transação (orders.extras.ts).
      // O cliente paga mercadoria + taxa de entrega: no fiado, a caderneta lança os dois (o estorno devolve o lançado).
      const payable = shipping ? fromCents(toCents(cart.total) + toCents(shipping.fee)).toFixed(2) : cart.total
      await onOrderPlaced(tx, { orderId, merchantId: cart.merchantId, customerId: customer.id, total: payable, paymentMethod: input.paymentMethod, lines: cart.lines, schedule: input.schedule })
      // A comanda entra na fila na MESMA transação do pedido: se o caixa estiver offline, o job espera.
      printJobId = (await ops?.enqueuePrint(tx, orderId, cart.merchantId)) ?? null
      return (await repo.findOrderById(tx, orderId))!
    })

    // Só depois do COMMIT: o painel nunca recebe um pedido que não existe no banco.
    publish(() => events.orderCreated(order), 'order:created')
    void ops?.announcePrint(printJobId)
    void ops?.pushToUsers([order.merchantId], { title: `Novo pedido · R$ ${order.totalPrice.toFixed(2).replace('.', ',')}`, body: `${order.contact.name ?? order.customer?.name ?? 'Cliente'} fez um pedido.`, url: '/manager', tag: `order-${order.id}` }, 'MERCHANT')
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
      // Depois dos itens: combos baixam os componentes (listOrderLines expande a composição).
      await reserveStock(tx, await repo.listOrderLines(tx, orderId), { orderId })
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
        await reserveStock(tx, await repo.listOrderLines(tx, orderId), { orderId })
      } else if (next === 'CANCELLED' && current.status === 'IN_PREPARATION') {
        await repo.restoreStock(tx, await repo.listOrderLines(tx, orderId), { orderId })
      }
      // Cancelar devolve o saldo da oferta relâmpago e o limite do cliente (o estoque volta pelo livro, acima).
      if (next === 'CANCELLED') await releaseOffers(tx, current.customer_id, await repo.listOrderFlashLines(tx, orderId))

      // [caderneta · encomendas · prato do dia] devolve porções, vaga da faixa e estorna o fiado.
      if (next === 'CANCELLED') await onOrderCancelled(tx, orderId)

      await repo.setStatus(tx, orderId, next)
      return (await repo.findOrderById(tx, orderId))!
    })

    publish(() => events.orderStatusUpdated(order), 'order:status_updated')
    if (order.customer && (next === 'READY' || next === 'CANCELLED' || next === 'IN_PREPARATION')) {
      const text = { IN_PREPARATION: 'Seu pedido foi aceito e está sendo preparado.', READY: 'Seu pedido está pronto!', CANCELLED: 'Seu pedido foi cancelado pela loja.' }[next]
      void ops?.pushToUsers([order.customer.id], { title: 'VizinhoHub', body: text, url: `/acompanhar/${order.id}`, tag: `order-${order.id}` }, 'CUSTOMER')
    }
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
