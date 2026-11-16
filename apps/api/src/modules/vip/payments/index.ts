import type { Env } from '../../../shared/env.js'
import { createAsaasProvider } from './asaas.js'
import type { PaymentGatewayProvider } from './gateway.js'
import { createMockProvider } from './mock.js'

export type { PaymentGatewayProvider } from './gateway.js'

// VIP_PROVIDER escolhe o adapter. env.ts já garante a chave e o token quando for asaas.
export function createPaymentProvider(env: Env): PaymentGatewayProvider {
  if (env.VIP_PROVIDER === 'asaas') {
    return createAsaasProvider({ apiKey: env.ASAAS_API_KEY!, baseUrl: env.ASAAS_BASE_URL, webhookToken: env.ASAAS_WEBHOOK_TOKEN! })
  }
  return createMockProvider({ secret: env.VIP_MOCK_WEBHOOK_SECRET })
}
