import { z } from 'zod'

// Os schemas de entrada vêm do pacote de contratos (fonte única entre API e front).
export {
  confirmPinSchema,
  courierLocationSchema,
  courierRegisterSchema,
  courierStatusSchema,
  failDeliverySchema,
  listDeliveriesSchema,
  requestDeliverySchema,
  storeDeliveryConfigSchema,
} from '@vizinhohub/contracts/delivery'
export type {
  CourierDTO,
  CourierLocationDTO,
  DeliveryDTO,
  DeliveryOfferDTO,
  StoreDeliveryConfigDTO,
  StoreDeliveryConfigInput,
} from '@vizinhohub/contracts/delivery'

export const idParam = z.object({ id: z.uuid() })
export const merchantParam = z.object({ merchantId: z.uuid() })
export const orderParam = z.object({ orderId: z.uuid() })

/** Raio (m) em volta da loja onde procuramos entregadores disponíveis para o convite. */
export const COURIER_SEARCH_RADIUS_M = 5000
/** Tempo que o convite fica aberto. */
export const OFFER_TTL_MIN = 2
/** Tentativas erradas do PIN até travar a entrega (só o lojista libera). */
export const MAX_PIN_ATTEMPTS = 5
/** Intervalos mínimos do rastreamento (s). */
export const LOCATION_MIN_INTERVAL_S = 5
export const LOCATION_LOG_INTERVAL_S = 15
/** LGPD: o rastro de GPS é apagado depois deste prazo. */
export const LOCATION_RETENTION_DAYS = 30
