import { randomInt } from 'node:crypto'
import type { AuthUser } from '../../shared/auth.js'
import { type Db, type DbClient, withTransaction } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import type { OrderEvents } from '../../shared/realtime.js'
import { findOrderById } from '../orders/orders.repository.js'
import * as repo from './delivery.repository.js'
import {
  COURIER_SEARCH_RADIUS_M,
  LOCATION_LOG_INTERVAL_S,
  LOCATION_MIN_INTERVAL_S,
  MAX_PIN_ATTEMPTS,
  OFFER_TTL_MIN,
} from './delivery.schema.js'
import type { CourierDTO, CourierLocationDTO, DeliveryDTO, DeliveryOfferDTO, StoreDeliveryConfigDTO, StoreDeliveryConfigInput } from './delivery.schema.js'
import type { CourierRegisterInput, RequestDeliveryInput } from '@vizinhohub/contracts/delivery'

// Ponte entre o caso de uso e o transporte (o service não conhece Socket.io).
export interface DeliveryEvents {
  /** Convite para um entregador do pool (sala `courier:<id>`). */
  offered(courierId: string, offer: DeliveryOfferDTO): void
  /** Ponto novo do entregador (sala `delivery:<id>`). */
  location(point: CourierLocationDTO): void
  /** Entrega criada: coloca lojista e cliente na sala `delivery:<id>`. */
  created(deliveryId: string, merchantId: string, customerId: string | null): void
}

export const noopDeliveryEvents: DeliveryEvents = { offered() {}, location() {}, created() {} }

const orderNotFound = () => new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
const deliveryNotFound = () => new AppError(404, 'DELIVERY_NOT_FOUND', 'Entrega não encontrada.')
const notCourier = () => new AppError(403, 'NOT_A_COURIER', 'Cadastre seu perfil de entregador primeiro.')

// Falha ao avisar via WebSocket nunca desfaz uma operação já gravada.
function safely(emit: () => void, name: string) {
  try {
    emit()
  } catch (err) {
    console.error(`Falha ao publicar ${name}`, err)
  }
}

type Actor = { kind: 'courier' | 'merchant'; id: string }

const newPin = () => String(randomInt(0, 10_000)).padStart(4, '0')

export function createDeliveryService(deps: { db: Db; events?: DeliveryEvents; orderEvents?: OrderEvents }) {
  const { db } = deps
  const events = deps.events ?? noopDeliveryEvents

  // ---- configuração da loja (lojista) ------------------------------------------------------------

  const getConfig = (merchantId: string) => repo.findConfig(db, merchantId)

  /** Pública: o checkout mostra a taxa e o raio (sem dados sensíveis). */
  async function getPublicConfig(merchantId: string) {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND role = 'MERCHANT'`, [merchantId])
    if (!rows[0]) throw new AppError(404, 'STORE_NOT_FOUND', 'Loja não encontrada.')
    const c = await repo.findConfig(db, merchantId)
    return { deliveryEnabled: c.deliveryEnabled, deliveryRadiusM: c.deliveryRadiusM, deliveryFee: c.deliveryFee }
  }

  async function saveConfig(merchantId: string, input: StoreDeliveryConfigInput): Promise<StoreDeliveryConfigDTO> {
    return withTransaction(db, async (tx) => {
      const merged = { ...(await repo.findConfig(tx, merchantId)), ...input }
      // Mesma regra do CHECK flash_inside_delivery, com mensagem amigável (a validação parcial não vê o valor salvo).
      if (merged.deliveryEnabled && merged.flashRadiusM > merged.deliveryRadiusM) {
        throw new AppError(422, 'FLASH_OUTSIDE_DELIVERY', 'O raio do Flash não pode passar do raio de entrega.')
      }
      await tx.query(
        `INSERT INTO store_delivery_config (merchant_id, has_own_fleet, delivery_enabled, delivery_radius_m, delivery_fee,
                                            flash_enabled, flash_radius_m, flash_fee, flash_eta_min, auto_print)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (merchant_id) DO UPDATE SET
           has_own_fleet = EXCLUDED.has_own_fleet, delivery_enabled = EXCLUDED.delivery_enabled,
           delivery_radius_m = EXCLUDED.delivery_radius_m, delivery_fee = EXCLUDED.delivery_fee,
           flash_enabled = EXCLUDED.flash_enabled, flash_radius_m = EXCLUDED.flash_radius_m, flash_fee = EXCLUDED.flash_fee,
           flash_eta_min = EXCLUDED.flash_eta_min, auto_print = EXCLUDED.auto_print, updated_at = now()`,
        [merchantId, merged.hasOwnFleet, merged.deliveryEnabled, merged.deliveryRadiusM, merged.deliveryFee, merged.flashEnabled, merged.flashRadiusM, merged.flashFee, merged.flashEtaMin, merged.autoPrint],
      )
      return repo.findConfig(tx, merchantId)
    })
  }

  // ---- lojista: chamar entregador -------------------------------------------------------------------

  /**
   * Cria a entrega de um pedido pronto e convida os entregadores disponíveis perto da loja.
   * Loja com frota própria não aciona o pool: a entrega fica REQUESTED, sem convites.
   */
  async function requestDelivery(merchantId: string, input: RequestDeliveryInput): Promise<{ delivery: DeliveryDTO; offered: number }> {
    const created = await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{
        id: string
        merchant_id: string
        customer_id: string | null
        status: string
        fulfillment: string
        delivery_fee: string
        delivery_lat: string | null
        delivery_lng: string | null
        store_lat: string | null
        store_lng: string | null
      }>(
        `SELECT o.id, o.merchant_id, o.customer_id, o.status, o.fulfillment, o.delivery_fee::text, o.delivery_lat, o.delivery_lng,
                u.latitude AS store_lat, u.longitude AS store_lng
           FROM orders o JOIN users u ON u.id = o.merchant_id
          WHERE o.id = $1 FOR UPDATE OF o`,
        [input.orderId],
      )
      const o = rows[0]
      if (!o || o.merchant_id !== merchantId) throw orderNotFound()
      if (o.fulfillment !== 'DELIVERY' && o.fulfillment !== 'FLASH') throw new AppError(422, 'NOT_A_DELIVERY_ORDER', 'Este pedido é para retirada na loja.')
      if (o.status !== 'READY') throw new AppError(409, 'ORDER_NOT_READY', 'Só é possível chamar o entregador quando o pedido está pronto.')
      const dropLat = input.dropoffLat ?? (o.delivery_lat === null ? null : Number(o.delivery_lat))
      const dropLng = input.dropoffLng ?? (o.delivery_lng === null ? null : Number(o.delivery_lng))
      if (dropLat === null || dropLng === null) throw new AppError(422, 'DELIVERY_LOCATION_REQUIRED', 'O pedido não tem a localização de entrega.')
      if (o.store_lat === null || o.store_lng === null) throw new AppError(422, 'STORE_WITHOUT_LOCATION', 'Cadastre a localização da loja.')
      const dup = await tx.query(`SELECT 1 FROM deliveries WHERE order_id = $1`, [o.id])
      if (dup.rowCount) throw new AppError(409, 'DELIVERY_EXISTS', 'Já existe uma entrega para este pedido.')

      const config = await repo.findConfig(tx, merchantId)
      // O repasse ao entregador é só REGISTRADO aqui (acerto direto com o lojista); por padrão, a taxa de entrega do pedido.
      const courierFee = input.courierFee ?? Number(o.delivery_fee)
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO deliveries (order_id, merchant_id, pin_code, courier_fee, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, distance_m)
         VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric,
                 round(distance_m($5::numeric::float8, $6::numeric::float8, $7::numeric::float8, $8::numeric::float8))::int)
         RETURNING id`,
        [o.id, merchantId, newPin(), courierFee, o.store_lat, o.store_lng, dropLat, dropLng],
      )
      const deliveryId = ins.rows[0]!.id
      let offered: { courier_id: string }[] = []
      if (!config.hasOwnFleet) {
        offered = (
          await tx.query<{ courier_id: string }>(
            `INSERT INTO delivery_offers (delivery_id, courier_id, distance_m, expires_at)
             SELECT $1, c.user_id, round(x.dist)::int, now() + make_interval(mins => $5)
               FROM couriers c
               CROSS JOIN LATERAL (SELECT distance_m(c.last_lat::float8, c.last_lng::float8, $2::float8, $3::float8) AS dist) x
              WHERE c.status = 'AVAILABLE' AND c.approved AND c.last_lat IS NOT NULL AND c.last_lng IS NOT NULL
                AND x.dist <= $4
              ORDER BY x.dist
              LIMIT 20
             RETURNING courier_id`,
            [deliveryId, o.store_lat, o.store_lng, COURIER_SEARCH_RADIUS_M, OFFER_TTL_MIN],
          )
        ).rows
        if (offered.length) await tx.query(`UPDATE deliveries SET status = 'OFFERED' WHERE id = $1`, [deliveryId])
      }
      return { deliveryId, merchantId, customerId: o.customer_id, courierIds: offered.map((r) => r.courier_id) }
    })

    safely(() => events.created(created.deliveryId, created.merchantId, created.customerId), 'delivery:created')
    if (created.courierIds.length) {
      for (const offer of await repo.listOffersOfDelivery(db, created.deliveryId)) {
        safely(() => events.offered(offer.courierId, offer), 'delivery:offered')
      }
    }
    return { delivery: (await repo.findDelivery(db, created.deliveryId, true))!, offered: created.courierIds.length }
  }

  async function listMine(merchantId: string, status: string | null, limit: number) {
    return repo.listMerchantDeliveries(db, merchantId, status, limit)
  }

  /** Pedidos com entrega da loja + a entrega de cada um (painel "Entregas"). */
  async function listMerchantOrders(merchantId: string) {
    const { rows } = await db.query(
      `SELECT o.id AS "orderId", o.status AS "orderStatus", o.fulfillment, o.total_price::float8 AS "totalPrice",
              o.delivery_fee::float8 AS "deliveryFee", o.contact_name AS "customerName", o.delivery_address AS "deliveryAddress",
              ${repo.iso('o.created_at')} AS "createdAt",
              d.id AS "deliveryId", d.status AS "deliveryStatus", d.pin_attempts AS "pinAttempts",
              d.pin_attempts >= ${MAX_PIN_ATTEMPTS} AS "pinLocked", d.courier_fee::float8 AS "courierFee",
              cu.name AS "courierName",
              (d.id IS NOT NULL AND d.courier_id IS NULL AND COALESCE(sc.has_own_fleet, FALSE)) AS "ownFleet"
         FROM orders o
         LEFT JOIN deliveries d ON d.order_id = o.id
         LEFT JOIN store_delivery_config sc ON sc.merchant_id = o.merchant_id
         LEFT JOIN users cu ON cu.id = d.courier_id
        WHERE o.merchant_id = $1 AND o.fulfillment IN ('DELIVERY', 'FLASH')
          AND (o.status IN ('PENDING', 'IN_PREPARATION', 'READY') OR d.status IN ('REQUESTED', 'OFFERED', 'ACCEPTED', 'PICKED_UP')
               OR o.updated_at > now() - interval '2 days')
        ORDER BY o.created_at DESC LIMIT 100`,
      [merchantId],
    )
    return rows
  }

  /** Só o lojista libera: zera as tentativas e troca o PIN (quem chutou os 5 já sabe os anteriores). */
  async function unlockPin(merchantId: string, deliveryId: string): Promise<DeliveryDTO> {
    const { rows } = await db.query(
      `UPDATE deliveries SET pin_attempts = 0, pin_code = $3
        WHERE id = $1 AND merchant_id = $2 AND status IN ('ACCEPTED', 'PICKED_UP') RETURNING id`,
      [deliveryId, merchantId, newPin()],
    )
    if (!rows[0]) {
      const exists = await db.query(`SELECT 1 FROM deliveries WHERE id = $1 AND merchant_id = $2`, [deliveryId, merchantId])
      if (!exists.rowCount) throw deliveryNotFound()
      throw new AppError(409, 'DELIVERY_NOT_ACTIVE', 'A entrega não está em andamento.')
    }
    return (await repo.findDelivery(db, deliveryId, true))!
  }

  // ---- cliente / lojista: ver a entrega do pedido -------------------------------------------------

  async function trackOrder(user: AuthUser, orderId: string) {
    const { rows } = await db.query<{
      id: string
      customer_id: string | null
      merchant_id: string
      status: string
      fulfillment: string
      fee: number
      store_lat: number | null
      store_lng: number | null
      drop_lat: number | null
      drop_lng: number | null
    }>(
      `SELECT o.id, o.customer_id, o.merchant_id, o.status, o.fulfillment, o.delivery_fee::float8 AS fee,
              u.latitude::float8 AS store_lat, u.longitude::float8 AS store_lng,
              o.delivery_lat::float8 AS drop_lat, o.delivery_lng::float8 AS drop_lng
         FROM orders o JOIN users u ON u.id = o.merchant_id WHERE o.id = $1`,
      [orderId],
    )
    const o = rows[0]
    const mine = user.role === 'MERCHANT' ? o?.merchant_id === user.id : o?.customer_id === user.id
    if (!o || !mine) throw orderNotFound()
    const delivery = (await repo.findDeliveryByOrder(db, orderId, true)) ?? null
    const courier = delivery?.courierId ? await repo.findCourier(db, delivery.courierId) : undefined
    return {
      orderId: o.id,
      orderStatus: o.status,
      fulfillment: o.fulfillment,
      deliveryFee: o.fee,
      store: o.store_lat === null ? null : { lat: o.store_lat, lng: o.store_lng },
      dropoff: o.drop_lat === null ? null : { lat: o.drop_lat, lng: o.drop_lng },
      delivery,
      courier: courier ? { name: courier.name, vehicle: courier.vehicle, lat: courier.lastLat, lng: courier.lastLng, lastSeenAt: courier.lastSeenAt } : null,
    }
  }

  // ---- entregador -----------------------------------------------------------------------------------

  async function registerCourier(userId: string, input: CourierRegisterInput): Promise<CourierDTO> {
    // Aprovado já no cadastro: acerto direto com o lojista, sem moderação da plataforma (decisão do projeto).
    await db.query(
      `INSERT INTO couriers (user_id, vehicle, neighborhood, city, approved) VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET vehicle = EXCLUDED.vehicle, neighborhood = EXCLUDED.neighborhood, city = EXCLUDED.city`,
      [userId, input.vehicle, input.neighborhood, input.city],
    )
    return (await repo.findCourier(db, userId))!
  }

  async function getCourier(userId: string): Promise<CourierDTO> {
    return (await repo.findCourier(db, userId)) ?? Promise.reject(notCourier())
  }

  async function setCourierStatus(userId: string, status: 'OFFLINE' | 'AVAILABLE'): Promise<CourierDTO> {
    const { rowCount } = await db.query(`UPDATE couriers SET status = $2 WHERE user_id = $1 AND status <> 'BUSY'`, [userId, status])
    if (!rowCount) {
      await getCourier(userId)
      throw new AppError(409, 'COURIER_BUSY', 'Conclua a corrida em andamento antes de mudar o status.')
    }
    return (await repo.findCourier(db, userId))!
  }

  async function listOffers(userId: string): Promise<DeliveryOfferDTO[]> {
    await getCourier(userId)
    return repo.listOpenOffers(db, userId)
  }

  /** A corrida em andamento do entregador (ou null). Sem PIN. */
  async function activeDelivery(userId: string) {
    await getCourier(userId)
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM deliveries WHERE courier_id = $1 AND status IN ('ACCEPTED', 'PICKED_UP')`, [userId])
    if (!rows[0]) return null
    const delivery = (await repo.findDelivery(db, rows[0].id, false))!
    const { rows: info } = await db.query(
      `SELECT COALESCE(u.store_name, u.name) AS "storeName", o.delivery_address AS "deliveryAddress", o.contact_name AS "customerName", o.phone
         FROM deliveries d JOIN users u ON u.id = d.merchant_id JOIN orders o ON o.id = d.order_id WHERE d.id = $1`,
      [delivery.id],
    )
    return { ...delivery, ...info[0] }
  }

  /**
   * Aceite atômico: `UPDATE ... WHERE courier_id IS NULL` decide no banco quem leva (só 1 entre N simultâneos).
   * Quem perde recebe 409 DELIVERY_TAKEN e nada muda para ele (a transação desfaz).
   */
  async function acceptOffer(courierId: string, deliveryId: string): Promise<DeliveryDTO> {
    await withTransaction(db, async (tx) => {
      const me = await tx.query<{ status: string }>(`SELECT status FROM couriers WHERE user_id = $1 AND approved FOR UPDATE`, [courierId])
      if (!me.rows[0]) throw notCourier()
      if (me.rows[0].status !== 'AVAILABLE') throw new AppError(409, 'COURIER_NOT_AVAILABLE', 'Fique disponível para aceitar corridas.')
      const offer = await tx.query(
        `SELECT 1 FROM delivery_offers WHERE delivery_id = $1 AND courier_id = $2 AND status = 'PENDING' AND expires_at > now()`,
        [deliveryId, courierId],
      )
      if (!offer.rowCount) throw new AppError(409, 'DELIVERY_TAKEN', 'Esta corrida não está mais disponível.')

      const claim = await tx.query(
        `UPDATE deliveries SET courier_id = $1, status = 'ACCEPTED', accepted_at = now()
          WHERE id = $2 AND courier_id IS NULL AND status IN ('REQUESTED', 'OFFERED')`,
        [courierId, deliveryId],
      )
      if (claim.rowCount !== 1) throw new AppError(409, 'DELIVERY_TAKEN', 'Outro entregador aceitou esta corrida primeiro.')

      await tx.query(`UPDATE couriers SET status = 'BUSY' WHERE user_id = $1`, [courierId])
      await tx.query(
        `UPDATE delivery_offers SET status = CASE WHEN courier_id = $2 THEN 'ACCEPTED' ELSE 'EXPIRED' END
          WHERE delivery_id = $1 AND status = 'PENDING'`,
        [deliveryId, courierId],
      )
    })
    return (await repo.findDelivery(db, deliveryId, false))!
  }

  async function declineOffer(courierId: string, deliveryId: string): Promise<void> {
    await getCourier(courierId)
    await db.query(`UPDATE delivery_offers SET status = 'DECLINED' WHERE delivery_id = $1 AND courier_id = $2 AND status = 'PENDING'`, [deliveryId, courierId])
  }

  /**
   * Posição do entregador (o app manda a cada ~5 s). O servidor aceita no máximo 1 ponto a cada 5 s, repassa
   * ao cliente em tempo real e grava no log só a cada ~15 s. Sem corrida ativa, só atualiza a última posição
   * (é com ela que o pool escolhe quem convidar).
   */
  async function reportLocation(userId: string, point: { lat: number; lng: number }): Promise<{ accepted: boolean }> {
    const upd = await db.query(
      `UPDATE couriers SET last_lat = $2, last_lng = $3, last_seen_at = now()
        WHERE user_id = $1 AND status <> 'OFFLINE'
          AND (last_seen_at IS NULL OR last_seen_at <= now() - make_interval(secs => $4))`,
      [userId, point.lat, point.lng, LOCATION_MIN_INTERVAL_S],
    )
    if (!upd.rowCount) {
      const c = await getCourier(userId)
      if (c.status === 'OFFLINE') throw new AppError(409, 'COURIER_OFFLINE', 'Fique disponível para enviar sua posição.')
      return { accepted: false } // dentro da janela de 5 s
    }
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM deliveries WHERE courier_id = $1 AND status IN ('ACCEPTED', 'PICKED_UP')`, [userId])
    const deliveryId = rows[0]?.id
    if (deliveryId) {
      const log = await db.query<{ recorded_at: string }>(
        `INSERT INTO courier_location_log (delivery_id, lat, lng)
         SELECT $1, $2, $3 WHERE NOT EXISTS (
           SELECT 1 FROM courier_location_log WHERE delivery_id = $1 AND recorded_at > now() - make_interval(secs => $4))
         RETURNING recorded_at::text`,
        [deliveryId, point.lat, point.lng, LOCATION_LOG_INTERVAL_S],
      )
      void log
      safely(() => events.location({ deliveryId, lat: point.lat, lng: point.lng, recordedAt: new Date().toISOString() }), 'delivery:location')
    }
    return { accepted: true }
  }

  async function markPickedUp(courierId: string, deliveryId: string): Promise<DeliveryDTO> {
    const { rowCount } = await db.query(
      `UPDATE deliveries SET status = 'PICKED_UP', picked_up_at = now() WHERE id = $1 AND courier_id = $2 AND status = 'ACCEPTED'`,
      [deliveryId, courierId],
    )
    if (!rowCount) await explainStateError(courierId, deliveryId, 'Só é possível retirar uma corrida aceita.')
    return (await repo.findDelivery(db, deliveryId, false))!
  }

  /** Erro específico: corrida de outro entregador / inexistente = 404; estado errado = 409. */
  async function explainStateError(courierId: string, deliveryId: string, message: string): Promise<never> {
    const { rows } = await db.query(`SELECT 1 FROM deliveries WHERE id = $1 AND courier_id = $2`, [deliveryId, courierId])
    if (!rows[0]) throw deliveryNotFound()
    throw new AppError(409, 'INVALID_DELIVERY_STATE', message)
  }

  /**
   * Conclui a entrega com o PIN que o cliente mostra. Cada erro conta (pin_attempts, gravado mesmo com a
   * resposta de erro); na 5ª a entrega trava e só o lojista libera. No acerto o PIN é apagado (NULL).
   * Comum ao entregador do pool e ao lojista com frota própria (`actor` decide quem pode mexer).
   */
  async function completeWithPin(actor: Actor, deliveryId: string, pin: string): Promise<DeliveryDTO> {
    type Outcome = { kind: 'ok'; orderId: string } | { kind: 'wrong'; attempts: number } | { kind: 'locked' }
    const outcome = await withTransaction<Outcome>(db, async (tx) => {
      const d = await lockDelivery(tx, actor, deliveryId)
      if (d.status !== 'PICKED_UP') throw new AppError(409, 'INVALID_DELIVERY_STATE', 'Confirme a retirada do pedido antes de concluir a entrega.')
      if (d.pin_attempts >= MAX_PIN_ATTEMPTS || d.pin_code === null) return { kind: 'locked' }

      if (d.pin_code !== pin) {
        const attempts = d.pin_attempts + 1
        await tx.query(`UPDATE deliveries SET pin_attempts = $2 WHERE id = $1`, [deliveryId, attempts])
        return attempts >= MAX_PIN_ATTEMPTS ? { kind: 'locked' } : { kind: 'wrong', attempts }
      }
      // Acertou: o PIN é purgado no mesmo UPDATE que conclui.
      await tx.query(`UPDATE deliveries SET status = 'DELIVERED', delivered_at = now(), pin_code = NULL, pin_attempts = 0 WHERE id = $1`, [deliveryId])
      if (actor.kind === 'courier') {
        await tx.query(`UPDATE couriers SET status = 'AVAILABLE', deliveries_done = deliveries_done + 1 WHERE user_id = $1`, [actor.id])
      }
      await tx.query(`UPDATE orders SET status = 'COMPLETED', updated_at = now() WHERE id = $1 AND status = 'READY'`, [d.order_id])
      return { kind: 'ok', orderId: d.order_id }
    })

    if (outcome.kind === 'locked') throw new AppError(423, 'PIN_LOCKED', 'Entrega travada por tentativas erradas. Peça ao lojista para liberar.')
    if (outcome.kind === 'wrong') {
      const left = MAX_PIN_ATTEMPTS - outcome.attempts
      throw new AppError(422, 'PIN_INVALID', `PIN incorreto. Restam ${left} tentativa${left === 1 ? '' : 's'}.`, { attemptsLeft: left })
    }
    if (deps.orderEvents) {
      const order = await findOrderById(db, outcome.orderId)
      if (order) safely(() => deps.orderEvents!.orderStatusUpdated(order), 'order:status_updated')
    }
    return (await repo.findDelivery(db, deliveryId, actor.kind === 'merchant'))!
  }

  const confirmPin = (courierId: string, deliveryId: string, pin: string) => completeWithPin({ kind: 'courier', id: courierId }, deliveryId, pin)

  // ---- lojista com frota própria --------------------------------------------------------------------

  /** Frota própria: a loja usa a frota própria, a entrega não tem entregador do pool (courier_id NULL). */
  const notOwnFleet = () => new AppError(409, 'NOT_OWN_FLEET', 'Esta entrega não é de frota própria.')

  async function lockDelivery(tx: DbClient, actor: Actor, deliveryId: string) {
    const { rows } = await tx.query<{ status: string; pin_code: string | null; pin_attempts: number; order_id: string; courier_id: string | null }>(
      actor.kind === 'courier'
        ? `SELECT status, pin_code, pin_attempts, order_id, courier_id FROM deliveries WHERE id = $1 AND courier_id = $2 FOR UPDATE`
        : `SELECT status, pin_code, pin_attempts, order_id, courier_id FROM deliveries WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [deliveryId, actor.id],
    )
    const d = rows[0]
    if (!d) throw deliveryNotFound()
    if (actor.kind === 'merchant') {
      if (d.courier_id !== null || !(await repo.findConfig(tx, actor.id)).hasOwnFleet) throw notOwnFleet()
    }
    return d
  }

  /** Lojista: "saiu para entrega" (mesmo efeito do pickup do entregador). */
  async function ownFleetPickup(merchantId: string, deliveryId: string): Promise<DeliveryDTO> {
    await withTransaction(db, async (tx) => {
      const d = await lockDelivery(tx, { kind: 'merchant', id: merchantId }, deliveryId)
      if (d.status !== 'REQUESTED') throw new AppError(409, 'INVALID_DELIVERY_STATE', 'Só é possível despachar uma entrega que ainda não saiu.')
      await tx.query(`UPDATE deliveries SET status = 'PICKED_UP', picked_up_at = now() WHERE id = $1`, [deliveryId])
    })
    return (await repo.findDelivery(db, deliveryId, true))!
  }

  const ownFleetDeliver = (merchantId: string, deliveryId: string, pin: string) => completeWithPin({ kind: 'merchant', id: merchantId }, deliveryId, pin)

  /** Lojista: a entrega da frota própria não aconteceu (o PIN some). */
  async function ownFleetFail(merchantId: string, deliveryId: string, reason: string): Promise<DeliveryDTO> {
    await withTransaction(db, async (tx) => {
      const d = await lockDelivery(tx, { kind: 'merchant', id: merchantId }, deliveryId)
      if (d.status !== 'REQUESTED' && d.status !== 'PICKED_UP') throw new AppError(409, 'INVALID_DELIVERY_STATE', 'A entrega não está em andamento.')
      await tx.query(`UPDATE deliveries SET status = 'FAILED', failure_reason = $2, pin_code = NULL WHERE id = $1`, [deliveryId, reason])
    })
    return (await repo.findDelivery(db, deliveryId, true))!
  }

  /** Entregador desiste ou não consegue entregar: a entrega falha, o PIN some e ele volta a ficar disponível. */
  async function failDelivery(courierId: string, deliveryId: string, reason: string): Promise<DeliveryDTO> {
    await withTransaction(db, async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE deliveries SET status = 'FAILED', failure_reason = $3, pin_code = NULL
          WHERE id = $1 AND courier_id = $2 AND status IN ('ACCEPTED', 'PICKED_UP')`,
        [deliveryId, courierId, reason],
      )
      if (!rowCount) await explainStateError(courierId, deliveryId, 'A corrida não está em andamento.')
      await tx.query(`UPDATE couriers SET status = 'AVAILABLE' WHERE user_id = $1`, [courierId])
    })
    return (await repo.findDelivery(db, deliveryId, false))!
  }

  /** Apaga o rastro de GPS mais velho que `days` (LGPD). Devolve quantos pontos saíram. */
  async function purgeOldLocations(days: number): Promise<number> {
    const { rowCount } = await db.query(`DELETE FROM courier_location_log WHERE recorded_at < now() - make_interval(days => $1)`, [days])
    return rowCount ?? 0
  }

  return {
    getConfig,
    getPublicConfig,
    saveConfig,
    requestDelivery,
    listMine,
    listMerchantOrders,
    unlockPin,
    trackOrder,
    registerCourier,
    getCourier,
    setCourierStatus,
    listOffers,
    activeDelivery,
    acceptOffer,
    declineOffer,
    reportLocation,
    markPickedUp,
    confirmPin,
    ownFleetPickup,
    ownFleetDeliver,
    ownFleetFail,
    failDelivery,
    purgeOldLocations,
  }
}

export type DeliveryService = ReturnType<typeof createDeliveryService>
