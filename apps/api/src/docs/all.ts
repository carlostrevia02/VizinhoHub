import type { RouteDoc } from './registry.js'
import { accountRoutes } from './routes/account.js'
import { coreRoutes } from './routes/core.js'
import { marketplaceRoutes } from './routes/marketplace.js'
import { operationsRoutes } from './routes/operations.js'

// Todas as rotas documentadas da API (a fonte única do spec e da trava de test/openapi.test.ts).
export const documentedRoutes: RouteDoc[] = [...coreRoutes, ...accountRoutes, ...marketplaceRoutes, ...operationsRoutes]
