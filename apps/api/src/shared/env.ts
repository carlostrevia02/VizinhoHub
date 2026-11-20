import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET precisa de pelo menos 16 caracteres'),
  // Origens do frontend autorizadas (HTTP e WebSocket), separadas por vírgula.
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:3000'),
  // Documentação da API: Swagger UI em /api/docs e o spec em /api/openapi.json. 'false' desliga as duas rotas.
  API_DOCS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Projeto Firebase cujos ID tokens a API aceita em POST /auth/firebase (ex.: "vizinhohub").
  // Sem isso a rota responde 501 e só o login próprio (e-mail/senha da API) funciona.
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  // Ofertas do Bairro: sem a chave, o job que lê os supermercados fica desligado (a API de ofertas segue de pé).
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  DEALS_MODEL: z.string().min(1).default('claude-opus-5-5'),
  DEALS_SCAN_INTERVAL_MIN: z.coerce.number().int().min(5).default(60),
  // Rota até a filial mais próxima (ofertas com ?lat=&lng=). Sem OSRM_URL usa o OSRM público (https://router.project-osrm.org);
  // com ele, um OSRM próprio. Se o OSRM falhar, a API estima por linha reta. BRANCH_AT_RADIUS_M (padrão 50) é lido em branches.service.ts.
  OSRM_URL: z.url().optional(),
  // Web Push (PWA). Gere o par com `npx web-push generate-vapid-keys`; sem ele o push fica desligado (o resto funciona).
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  VAPID_SUBJECT: z.string().min(1).default('mailto:contato@vizinhohub.example'),
  // Identifica o robô para os sites lidos (e para o robots.txt deles). Troque pelo contato real do projeto.
  DEALS_USER_AGENT: z.string().min(1).default('VizinhoHubBot/1.0 (ofertas de bairro; Unifor)'),
  // Clube VIP: provedor de pagamento. "mock" simula a cobrança (dev/teste/CI); "asaas" usa a API REST do Asaas.
  // A plataforma não custodia valores: o dinheiro vai direto ao provedor.
  VIP_PROVIDER: z.enum(['mock', 'asaas']).default('mock'),
  // mock: segredo do webhook (header x-vip-webhook-secret). Fora de produção vale um padrão; em produção, sem ele o webhook mock recusa tudo.
  VIP_MOCK_WEBHOOK_SECRET: z.string().min(8).optional(),
  // asaas: ASAAS_API_KEY e ASAAS_WEBHOOK_TOKEN são obrigatórios quando VIP_PROVIDER=asaas.
  ASAAS_API_KEY: z.string().min(1).optional(),
  ASAAS_BASE_URL: z.string().url().default('https://api-sandbox.asaas.com/v3'),
  ASAAS_WEBHOOK_TOKEN: z.string().min(16).optional(),
}).superRefine((env, ctx) => {
  if (env.VIP_PROVIDER !== 'asaas') return
  for (const key of ['ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN'] as const) {
    if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'obrigatório quando VIP_PROVIDER=asaas' })
  }
})

export type Env = z.infer<typeof schema>

// Falha cedo e com mensagem clara se faltar configuração.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Variáveis de ambiente inválidas:\n${problems}`)
  }
  if (parsed.data.NODE_ENV === 'production') assertProductionSafe(parsed.data, source)
  else parsed.data.VIP_MOCK_WEBHOOK_SECRET ??= 'dev-vip-webhook-secret'
  return parsed.data
}

// Em produção não vale subir com configuração de desenvolvimento.
function assertProductionSafe(env: Env, source: NodeJS.ProcessEnv) {
  const problems: string[] = []
  if (env.JWT_SECRET.length < 32 || /change|troque|secret|dev|123/i.test(env.JWT_SECRET)) {
    problems.push('JWT_SECRET precisa ser aleatório e ter 32+ caracteres (ex.: openssl rand -hex 32).')
  }
  if (!source.CORS_ORIGIN) problems.push('CORS_ORIGIN precisa listar a(s) origem(ns) do site (ex.: https://vizinhohub.example.com).')
  if (/localhost|127\.0\.0\.1/.test(env.CORS_ORIGIN)) problems.push('CORS_ORIGIN não pode apontar para localhost em produção.')
  if (problems.length) throw new Error(`Configuração insegura para produção:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
}

export const corsOrigins = (env: Env) => env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
