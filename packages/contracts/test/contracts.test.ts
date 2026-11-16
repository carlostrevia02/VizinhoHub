import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  adjustmentSchema,
  alertSchema,
  chargeOrderSchema,
  createComboSchema,
  createCreditAccountSchema,
  createFlashSchema,
  createPickupSlotSchema,
  createRecipeSchema,
  createVipPlanSchema,
  flashOrderItemSchema,
  optimizeCartSchema,
  radarQuerySchema,
  registerPaymentSchema,
  requestDeliverySchema,
  setDailyMenuSchema,
  storeDeliveryConfigSchema,
  trackEventSchema,
  vipMerchantSettingsSchema,
  SOCKET_EVENTS,
  merchantRoom,
} from '../src/index.js'

const U1 = '3f1c1a3e-6d1b-4b0e-9f0a-1a2b3c4d5e6f'
const U2 = '7b8e0c3a-2f4d-4c1e-8a5b-9d0e1f2a3b4c'

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  assert.equal(schema.safeParse(v).success, true, JSON.stringify(v))
const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  assert.equal(schema.safeParse(v).success, false, JSON.stringify(v))

describe('flash', () => {
  const base = { productId: U1, offerPrice: 9.9, qtyTotal: 10, durationMin: 60 }

  it('createFlashSchema aplica padrões', () => {
    const r = createFlashSchema.parse(base)
    assert.equal(r.maxPerCustomer, 2)
    assert.equal(r.radiusM, 2000)
    assert.equal(r.reason, 'MANUAL')
  })
  it('createFlashSchema rejeita valores inválidos', () => {
    bad(createFlashSchema, { ...base, offerPrice: 0 })
    bad(createFlashSchema, { ...base, offerPrice: 9.999 })
    bad(createFlashSchema, { ...base, qtyTotal: 1001 })
    bad(createFlashSchema, { ...base, durationMin: 4 })
    bad(createFlashSchema, { ...base, radiusM: 50 })
    bad(createFlashSchema, { ...base, reason: 'OTHER' })
    bad(createFlashSchema, { ...base, productId: 'x' })
  })
  it('radarQuerySchema converte strings de query', () => {
    const r = radarQuerySchema.parse({ lat: '-3.73', lng: '-38.52', limit: '10' })
    assert.equal(r.lat, -3.73)
    assert.equal(r.limit, 10)
    bad(radarQuerySchema, { lat: '95', lng: '0' })
    bad(radarQuerySchema, { lat: '0', lng: '0', limit: '101' })
  })
  it('alertSchema: "não perturbe" exige início e fim juntos', () => {
    const a = { latitude: -3.7, longitude: -38.5 }
    ok(alertSchema, a)
    ok(alertSchema, { ...a, quietFrom: '22:00', quietTo: '07:00' })
    bad(alertSchema, { ...a, quietFrom: '22:00' })
    bad(alertSchema, { ...a, quietTo: '07:00' })
    bad(alertSchema, { ...a, radiusM: 100 })
    bad(alertSchema, { ...a, quietFrom: '2200', quietTo: '0700' })
  })
  it('flashOrderItemSchema', () => {
    ok(flashOrderItemSchema, { flashOfferId: U1, quantity: 2 })
    bad(flashOrderItemSchema, { flashOfferId: U1, quantity: 0 })
    bad(flashOrderItemSchema, { flashOfferId: U1, quantity: 21 })
  })
})

describe('004 delivery', () => {
  it('requestDeliverySchema', () => {
    ok(requestDeliverySchema, { orderId: U1, dropoffLat: -3.7, dropoffLng: -38.5 })
    bad(requestDeliverySchema, { orderId: U1, dropoffLat: -91, dropoffLng: -38.5 })
  })
  it('storeDeliveryConfigSchema respeita o CHECK flash_inside_delivery', () => {
    ok(storeDeliveryConfigSchema, { deliveryEnabled: true, deliveryRadiusM: 3000, flashRadiusM: 800 })
    bad(storeDeliveryConfigSchema, { deliveryEnabled: true, deliveryRadiusM: 500, flashRadiusM: 800 })
    bad(storeDeliveryConfigSchema, { flashRadiusM: 1501 })
    bad(storeDeliveryConfigSchema, {})
  })
})

describe('005 ops', () => {
  it('trackEventSchema', () => {
    ok(trackEventSchema, { merchantId: U1, sessionId: U2, type: 'STORE_VIEW' })
    bad(trackEventSchema, { merchantId: U1, sessionId: U2, type: 'CLICK' })
  })
})

describe('007 smart-cart', () => {
  const loc = { lat: -3.7, lng: -38.5 }
  it('optimizeCartSchema', () => {
    const r = optimizeCartSchema.parse({ items: [{ canonicalId: 1, quantity: 2.5 }], ...loc })
    assert.equal(r.maxStores, 3)
    bad(optimizeCartSchema, { items: [], ...loc })
    bad(optimizeCartSchema, { items: [{ canonicalId: 1, quantity: 1 }], ...loc, maxStores: 4 })
  })
  it('createRecipeSchema', () => {
    const rec = { slug: 'feijoada', title: 'Feijoada', ingredients: [{ canonicalId: 1, quantity: 0.5 }] }
    ok(createRecipeSchema, rec)
    bad(createRecipeSchema, { ...rec, slug: 'Feijoada Boa' })
    bad(createRecipeSchema, { ...rec, ingredients: [{ canonicalId: 1, quantity: 0 }] })
    bad(createRecipeSchema, { ...rec, ingredients: [{ canonicalId: 1, quantity: 1 }, { canonicalId: 1, quantity: 2 }] })
  })
})

describe('008 credit', () => {
  it('createCreditAccountSchema', () => {
    ok(createCreditAccountSchema, { customerId: U1, creditLimit: 200, settlementDay: 28 })
    bad(createCreditAccountSchema, { customerId: U1, settlementDay: 29 })
    bad(createCreditAccountSchema, { customerId: U1, creditLimit: -1 })
  })
  it('pagamento positivo; ajuste não pode ser 0', () => {
    ok(registerPaymentSchema, { amount: 50.5, paymentMethod: 'PIX' })
    bad(registerPaymentSchema, { amount: 0 })
    ok(adjustmentSchema, { amount: -10, note: 'correção' })
    bad(adjustmentSchema, { amount: 0, note: 'x' })
    ok(chargeOrderSchema, { orderId: U1 })
  })
})

describe('008 scheduling', () => {
  it('createPickupSlotSchema', () => {
    ok(createPickupSlotSchema, { weekday: 0, startsAt: '14:00', endsAt: '18:00', capacity: 6 })
    bad(createPickupSlotSchema, { weekday: 7, startsAt: '14:00', endsAt: '18:00', capacity: 6 })
    bad(createPickupSlotSchema, { weekday: 1, startsAt: '18:00', endsAt: '14:00', capacity: 6 })
    bad(createPickupSlotSchema, { weekday: 1, startsAt: '9:00', endsAt: '14:00', capacity: 6 })
    bad(createPickupSlotSchema, { weekday: 1, startsAt: '14:00', endsAt: '18:00', capacity: 0 })
  })
})

describe('008 daily-menu', () => {
  it('setDailyMenuSchema', () => {
    ok(setDailyMenuSchema, { productId: U1, qtyTotal: 20, menuDate: '2026-11-16' })
    bad(setDailyMenuSchema, { productId: U1, qtyTotal: -1 })
    bad(setDailyMenuSchema, { productId: U1, qtyTotal: 5, menuDate: '16/11/2026' })
  })
  it('createComboSchema', () => {
    const combo = { name: 'Combo lanche', categoryId: 1, price: 19.9, components: [{ componentId: U1 }, { componentId: U2, quantity: 2 }] }
    ok(createComboSchema, combo)
    bad(createComboSchema, { ...combo, components: [{ componentId: U1 }] })
    bad(createComboSchema, { ...combo, components: [{ componentId: U1 }, { componentId: U1 }] })
  })
})

describe('009 vip', () => {
  it('createVipPlanSchema', () => {
    ok(createVipPlanSchema, { code: 'vip', name: 'VIP', priceMonthly: 14.9, tiers: [{ minMonths: 1, discountPct: 2 }, { minMonths: 3, discountPct: 4.5 }] })
    bad(createVipPlanSchema, { code: 'vip', name: 'VIP', priceMonthly: 14.9, tiers: [{ minMonths: 1, discountPct: 31 }] })
    bad(createVipPlanSchema, { code: 'vip', name: 'VIP', priceMonthly: 14.9, tiers: [{ minMonths: 1, discountPct: 4.55 }] })
    bad(createVipPlanSchema, { code: 'x'.repeat(21), name: 'VIP', priceMonthly: 14.9 })
  })
  it('vipMerchantSettingsSchema', () => {
    ok(vipMerchantSettingsSchema, { discountCapPct: 10, fundsFreeDelivery: true })
    bad(vipMerchantSettingsSchema, { discountCapPct: 30.1 })
    bad(vipMerchantSettingsSchema, {})
  })
})

describe('realtime', () => {
  it('nomes de evento e salas', () => {
    assert.equal(SOCKET_EVENTS.orderCreated, 'order:created')
    assert.equal(merchantRoom('abc'), 'merchant:abc')
  })
})
