// Grava o spec OpenAPI (YAML) na pasta de documentação a partir do mesmo registro que a API serve em /api/openapi.json.
// Uso: npm run openapi
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stringify } from 'yaml'
import { openApiSpec } from '../src/docs/openapi.js'

const target = path.resolve(import.meta.dirname, '../../../VizinhoHub - docs/openapi.yaml')
const header = '# Gerado por `npm run openapi` (apps/api) a partir do código: não edite à mão.\n# Fonte: apps/api/src/docs. Em execução: GET /api/openapi.json e Swagger UI em /api/docs.\n'

mkdirSync(path.dirname(target), { recursive: true })
writeFileSync(target, header + stringify(openApiSpec(), { lineWidth: 0 }), 'utf8')

const spec = openApiSpec()
const operations = Object.values(spec.paths as Record<string, object>).reduce((n, item) => n + Object.keys(item).filter((k) => k !== 'servers').length, 0)
console.log(`OpenAPI ${spec.openapi}: ${Object.keys(spec.paths).length} caminhos, ${operations} operações -> ${target}`)
