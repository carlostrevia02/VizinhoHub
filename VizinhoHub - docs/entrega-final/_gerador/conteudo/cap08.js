'use strict'
const { h1, h2, h3, p, ul, table, box } = require('../modelo')
const F = require('./fatos')
const dados = require('../dados/endpoints.json')

module.exports = () => {
  const out = []
  out.push(h1('Contrato da API'))
  out.push(p(`A API REST é descrita por uma especificação **OpenAPI 3** gerada do próprio código (\`apps/api/src/docs\`), com **${F.operacoes} operações** em ${F.grupos} grupos. Um teste (\`openapi.test.ts\`) confere a especificação contra as rotas realmente montadas no Express, o que evita que a documentação envelheça. O arquivo \`openapi.yaml\` fica na pasta de documentação, e a API serve a interface Swagger em \`/api/docs\` e o JSON em \`/api/openapi.json\` (controlado por \`API_DOCS\`). Este capítulo resume as convenções e lista as operações por grupo; o detalhe de cada corpo e resposta está no próprio OpenAPI.`))

  out.push(h2('Convenções'))
  out.push(table('Convenções gerais da API', ['Tema', 'Convenção'], [
    ['Base', '`/api/v1` (o prefixo `/api` sem versão continua valendo); rota de saúde em `/health`'],
    ['Formato', 'JSON (`application/json`); corpo validado por schemas zod do pacote `contracts`'],
    ['Autenticação', 'Cabeçalho `Authorization: Bearer <JWT>` (HS256, 7 dias). O papel é lido do banco a cada requisição, nunca do token'],
    ['Perfis de acesso', 'Público; Logado (qualquer conta); Cliente; Lojista (conta de comerciante); Entregador (conta de cliente com perfil de entregador); Provedor (segredo de webhook)'],
    ['Paginação', 'Parâmetros `limit` e `offset`; o total (com os filtros) vem no cabeçalho `X-Total-Count` nas listas que o usam (pedidos)'],
    ['Idioma', 'Mensagens de erro em português; códigos de erro estáveis em maiúsculas (o front decide o texto pelo código)'],
    ['Datas e fuso', 'ISO 8601; regras de "hoje" no fuso America/Fortaleza'],
    ['Compatibilidade', 'Versão `0.1.0` da especificação; sem política formal de depreciação (projeto em fase de MVP)'],
  ], { w: [0.2, 0.8], size: 'sm' }))

  out.push(h2('Erros'))
  out.push(p('Todos os erros seguem o mesmo envelope, `{ "error": { "code", "message", "details?" } }`. Erros de validação (zod) viram 400 `VALIDATION_ERROR` com a lista de campos em `details`. Violações de integridade do banco que escapem da validação viram 409 `DUPLICATE` ou 422 `INVALID_REFERENCE`, e falhas inesperadas viram 500 `INTERNAL_ERROR` sem expor detalhes.'))
  out.push(table('Status HTTP e códigos de erro mais relevantes', ['Status', 'Códigos (exemplos)', 'Significado'], [
    ['400', '`VALIDATION_ERROR`, `BAD_REQUEST`', 'Entrada inválida ou JSON malformado'],
    ['401', '`UNAUTHENTICATED`, `INVALID_TOKEN`, `INVALID_FIREBASE_TOKEN`', 'Sem token, token inválido ou expirado'],
    ['403', '`FORBIDDEN`, `NOT_CHAIN_MANAGER`', 'Autenticado, mas sem permissão para o recurso'],
    ['404', '`ORDER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `FLASH_NOT_FOUND`, `ROUTE_NOT_FOUND`', 'Não existe, ou pertence a outra loja ou cliente (não se revela a existência)'],
    ['409', '`INVALID_TRANSITION`, `EMAIL_IN_USE`, `DELIVERY_TAKEN`, `COUPON_ALREADY_CONFIRMED`, `FLASH_NOT_ACTIVE`, `DUPLICATE`', 'Conflito de estado, edição concorrente ou duplicidade'],
    ['413 e 415', '`FILE_TOO_LARGE`, `UNSUPPORTED_FILE`', 'Encarte acima de 20 MB (PDF) ou 5 MB (imagem), ou formato não aceito'],
    ['422', '`MULTIPLE_MERCHANTS`, `BELOW_MINIMUM`, `OUT_OF_RADIUS`, `FLASH_UNAVAILABLE`, `FLASH_LIMIT`, `CREDIT_LIMIT`, `DEAL_NOT_COUPON_ELIGIBLE`, `PIN_INVALID`, `LEAD_TIME`, `SLOT_INVALID`, `NO_VALID_DEALS`', 'Regra de negócio violada (a entrada era válida)'],
    ['423', '`PIN_LOCKED`', 'Entrega travada após 5 erros de PIN; só o lojista libera'],
    ['429', '`TOO_MANY_REQUESTS`, `FLYER_QUEUE_FULL`', 'Limite de taxa ou fila de leitura de encartes cheia'],
    ['500, 501, 502, 503', '`INTERNAL_ERROR`, `FIREBASE_NOT_CONFIGURED`, `FLYERS_DISABLED`, `PAYMENT_PROVIDER_ERROR`, `AUTH_PROVIDER_UNAVAILABLE`', 'Falha interna, recurso opcional desligado ou provedor externo indisponível'],
  ], { w: [0.12, 0.5, 0.38], size: 'sm', key: 'erros' }))

  out.push(h2('Operações por grupo'))
  out.push(p('As tabelas a seguir listam todas as operações do `openapi.yaml`, agrupadas pelas tags da especificação. A coluna "Acesso" indica quem pode chamar a rota. Rotas de comerciante exigem conta com papel `MERCHANT`; rotas de entregador usam a conta de um cliente que tem perfil de entregador.'))
  for (const g of dados.grupos) {
    const ops = dados.endpoints.filter((e) => e.grupo === g.name)
    if (!ops.length) continue
    out.push(h3(`${g.name} (${ops.length})`))
    if (g.description) out.push(p(g.description))
    out.push(table(`Operações: ${g.name}`, ['Método', 'Rota', 'Acesso', 'Resumo'], ops.map((e) => [`\`${e.metodo}\``, `\`${e.rota}\``, e.acesso, e.resumo]), { w: [0.1, 0.36, 0.14, 0.4], size: 'xs' }))
  }

  out.push(h2('Eventos Socket.io'))
  out.push(p('Os eventos de tempo real não fazem parte do OpenAPI (a própria especificação avisa). Estão definidos no pacote `contracts` (`realtime.ts`) e resumidos na [[tab:eventos]]. A conexão exige token JWT no handshake (`io(url, { auth: { token } })`), com exceção do namespace público `/catalog`.'))
  out.push(box('Observação sobre os contratos de tempo real', [
    'No pacote `contracts`, os comentários de `delivery:offered` e `delivery:location` ainda dizem "previsto (roadmap)", embora o código da API já emita os dois eventos (`delivery.events.ts`). O comentário está desatualizado; o código é a referência.',
  ]))
  return out
}
