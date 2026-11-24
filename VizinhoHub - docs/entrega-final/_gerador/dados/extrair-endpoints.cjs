'use strict'
// Extrai as operações de "VizinhoHub - docs/openapi.yaml" (gerado do código) para dados/endpoints.json.
//   node dados/extrair-endpoints.cjs
const fs = require('fs')
const path = require('path')
const Y = require('C:/Users/Usuário/Desktop/Unifor/projetos/VizinhoHub/apps/api/node_modules/yaml')
const spec = Y.parse(fs.readFileSync(path.resolve(__dirname, '../../../openapi.yaml'), 'utf8'))
const ACESSO = { MERCHANT: 'Lojista', CUSTOMER: 'Cliente' }
const out = []
for (const [rota, ops] of Object.entries(spec.paths)) {
  for (const [metodo, op] of Object.entries(ops)) {
    if (!op.operationId) continue
    let acesso = 'Público'
    if (op.security && op.security.length && op.security.every((s) => Object.keys(s).length)) acesso = ACESSO[op['x-required-role']] || 'Logado'
    if (rota === '/smart-cart/optimize') acesso = 'Público (lista salva: logado)'
    if (rota.startsWith('/delivery/courier') && acesso !== 'Público') acesso = 'Entregador (conta de cliente)'
    if (rota.startsWith('/vip/webhooks')) acesso = 'Provedor (segredo)'
    if (rota === '/events') acesso = 'Público (token opcional)'
    out.push({ grupo: op.tags[0], metodo: metodo.toUpperCase(), rota, acesso, resumo: op.summary })
  }
}
const ordem = spec.tags.map((t) => t.name)
out.sort((a, b) => ordem.indexOf(a.grupo) - ordem.indexOf(b.grupo))
fs.writeFileSync(path.join(__dirname, 'endpoints.json'), JSON.stringify({ grupos: spec.tags, endpoints: out, info: spec.info }, null, 1))
console.log(out.length, 'operações em', ordem.length, 'grupos')
