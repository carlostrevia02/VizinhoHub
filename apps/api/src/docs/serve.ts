import type { Express } from 'express'
import swaggerUi from 'swagger-ui-express'
import { openApiSpec } from './openapi.js'

// Rotas de documentação (ficam fora do próprio spec; o teste de test/openapi.test.ts as ignora por este conjunto).
export const DOCS_JSON_PATHS = ['/api/openapi.json', '/api/v1/openapi.json']
export const DOCS_UI_PATHS = ['/api/docs', '/api/v1/docs']

// Monta o JSON do spec e o Swagger UI. Chame antes do notFoundHandler.
export function mountApiDocs(app: Express) {
  const spec = openApiSpec()
  app.get(DOCS_JSON_PATHS, (_req, res) => {
    res.json(spec)
  })
  app.use(
    DOCS_UI_PATHS,
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'VizinhoHub API',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
    }),
  )
}
