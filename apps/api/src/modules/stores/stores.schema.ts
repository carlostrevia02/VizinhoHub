import { z } from 'zod'

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM.')
// null = fechado nesse período.
const period = z.object({ open: hhmm, close: hhmm }).nullable()

const money = z.number().min(0).max(100_000)

export const storeSettingsSchema = z
  .object({
    phone: z.string().trim().min(8).max(30).nullable(), // WhatsApp da loja
    address: z.string().trim().min(3).max(200).nullable(),
    hours: z.object({ weekdays: period, saturday: period, sunday: period }),
    delivery: z.object({
      deliveryEnabled: z.boolean(), // entrega no bairro
      pickupEnabled: z.boolean(), // retirada na loja
      minOrder: money, // pedido mínimo para entrega (R$)
    }),
    payments: z.object({ pix: z.boolean(), card: z.boolean(), cash: z.boolean() }),
  })
  .refine((s) => s.delivery.deliveryEnabled || s.delivery.pickupEnabled, {
    message: 'Ative ao menos uma forma de receber: entrega ou retirada.',
    path: ['delivery'],
  })
  .refine((s) => s.payments.pix || s.payments.card || s.payments.cash, {
    message: 'Ative ao menos uma forma de pagamento.',
    path: ['payments'],
  })

export type StoreSettings = z.infer<typeof storeSettingsSchema>
export type PaymentMethod = keyof StoreSettings['payments']

// Padrões de uma loja que ainda não configurou nada.
export const DEFAULT_SETTINGS: StoreSettings = {
  phone: null,
  address: null,
  hours: {
    weekdays: { open: '07:00', close: '21:00' },
    saturday: { open: '07:00', close: '20:00' },
    sunday: { open: '08:00', close: '13:00' },
  },
  delivery: { deliveryEnabled: true, pickupEnabled: true, minOrder: 0 },
  payments: { pix: true, card: true, cash: true },
}

export const storeIdSchema = z.object({ id: z.uuid() })
