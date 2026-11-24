'use strict'
const { h1, h2, h3, p, ul, table, box } = require('../modelo')
const F = require('./fatos')
const { todos } = require('./dados-rf')

const cont = (k) => todos.filter((r) => r.st === k).length

module.exports = () => [
  h1('Resultados, impactos e indicadores'),
  box('Princípio deste capítulo', [
    'Aqui se separa o que foi **medido no repositório** do que é **meta ou expectativa**. Nenhum número de usuários, vendas, economia ou satisfação de pessoas reais é apresentado, porque o projeto não registra uso real. Onde há dúvida, o texto diz "a confirmar".',
  ]),

  h2('Resultados medidos no repositório'),
  p('Os números abaixo foram obtidos em 23/11/2026 por contagem direta (git, SQL, OpenAPI, arquivos de teste) e por execução da suíte de testes.'),
  table('Métricas do repositório (23/11/2026)', ['Métrica', 'Valor', 'Como foi obtida'], [
    ['Commits', String(F.commits), '`git log`, de 29/09 a 23/11/2026, em 9 dias distintos'],
    ['Tabelas, índices, views, funções', `${F.tabelas}, ${F.indices}, ${F.views}, ${F.funcoes}`, 'Contagem em `db/schema.sql`'],
    ['Migrações', String(F.migracoes), 'Arquivos em `db/migrations` (numeração de 001 a 019, sem o 011)'],
    ['Módulos da API', String(F.modulosApi), 'Pastas em `apps/api/src/modules`'],
    ['Operações REST / rotas / grupos', `${F.operacoes} / ${F.rotas} / ${F.grupos}`, '`openapi.yaml`'],
    ['Ferramentas do servidor MCP', String(F.ferramentasMcp), '`apps/mcp-server`'],
    ['Telas (rotas do front)', String(F.telas), '`apps/web/src/App.jsx`'],
    ['Linhas de código (aprox.)', `API ${F.linhasApi} (TypeScript); testes da API ${F.linhasTestesApi}; front ${F.linhasWeb} (JS/JSX); MCP ${F.linhasMcp}; contratos ${F.linhasContratos}; SQL ${F.linhasSql}`, 'Contagem de linhas dos arquivos (inclui comentários e linhas em branco)'],
    ['Catálogo importado', `${F.produtosTotal} produtos (${F.produtosBase} + ${F.produtosAmpliacao}) em ${F.departamentos} departamentos`, '`db/catalog`'],
    ['Redes de supermercado cadastradas', String(F.redes), '`schema.sql`'],
    ['Testes da API', `${F.testesApi} (${F.arquivosTesteApi} arquivos, ${F.suitesApi} suítes), todos aprovados`, 'Execução em 23/11/2026'],
    ['Testes do MCP e dos contratos', `${F.testesMcp} e ${F.testesContratos}, todos aprovados`, 'Execução em 23/11/2026'],
    ['Verificação de tipos da API', 'Sem erros', '`tsc --noEmit`'],
    ['Requisitos funcionais', `${todos.length}: ${cont('I')} implementados, ${cont('P')} parciais, ${cont('PL')} planejados`, 'Cap. 4, verificado no código'],
  ], { w: [0.28, 0.4, 0.32], size: 'sm', key: 'metricas' }),
  p(`Em termos de entrega, ${Math.round((cont('I') / todos.length) * 100)}% dos requisitos funcionais listados estão implementados (${cont('I')} de ${todos.length}); os parciais têm API sem tela (abrir loja, envio de encarte, PDV) e os planejados são itens que ainda não existem (baixa no caixa da rede, tela de envio de encartes, interface de PDV, Next.js, WhatsApp automático e tela para abrir loja). O percentual descreve o escopo que o autor definiu, não valor entregue a usuários.`),
  p('Do ponto de vista técnico, o resultado mais relevante é a **correção sob concorrência**: os casos de venda de quantidade limitada, crédito, vagas, prato do dia e aceite de corrida foram medidos com 6 a 30 transações simultâneas e não produziram venda em excesso (seção 7.6). O segundo é a **rastreabilidade**: cada requisito aponta para módulo, rota, tela e teste (seção 4.8).'),

  h2('Indicadores planejados'),
  p('Os indicadores abaixo são **metas de acompanhamento**. Nenhum deles foi medido: não há usuários reais, e os dados do painel de Análises que aparecem nas capturas são de demonstração. A coluna "Fonte" indica onde o dado já é coletado pelo sistema.'),
  table('Indicadores planejados (não medidos)', ['Indicador', 'O que mede', 'Fonte no sistema', 'Meta'], [
    ['Lojas ativas', 'Comerciantes que receberam ao menos um pedido ou cupom no mês', '`orders`, `deal_coupons`', 'A definir pelo autor'],
    ['Pedidos por loja', 'Volume de pedidos online atendidos', '`orders` (canal `ONLINE`)', 'A definir'],
    ['Taxa de conversão da vitrine', 'Visitas até pedidos', 'Funil (`store_events`, 90 dias)', 'A definir'],
    ['Cupons gerados e confirmados', 'Interesse e conclusão nas ofertas do bairro', '`deal_coupons` (ACTIVE e REDEEMED)', 'A definir'],
    ['Economia do cliente', 'Diferença entre preço base e preço pago', '`deal_coupons.original_price − unit_price`; `orders.vip_savings`', 'A definir'],
    ['Alcance das ofertas relâmpago', 'Unidades vendidas sobre unidades ofertadas', '`flash_offers` (`qty_total`, `qty_available`)', 'A definir'],
    ['Tempo de atendimento do pedido', 'Do pedido novo ao pronto', '`orders.created_at`, `updated_at` e eventos', 'A definir'],
    ['Desperdício evitado', 'Itens com desconto por validade que foram vendidos', 'Produtos em Salva-Estoque dentro de pedidos', 'A definir'],
    ['Satisfação de comerciantes e moradores', 'Percepção de utilidade e facilidade de uso', 'Não coletada (exige questionário)', 'A definir'],
  ], { w: [0.22, 0.28, 0.3, 0.2], size: 'xs', key: 'indicadores' }),

  h2('Impactos esperados'),
  p('Os impactos descritos aqui são **esperados**, derivados do desenho do projeto, e dependem de uma implantação com usuários reais que ainda não ocorreu.'),
  ul([
    '**Para o comerciante:** menos pedidos perdidos em mensagens, uma visão única de pedidos, vendas e fiado, e um canal para escoar produtos perto do vencimento. Tudo sem comissão sobre as vendas do próprio mercadinho.',
    '**Para o morador:** comparar preços das redes perto de casa em um só lugar, ser avisado de ofertas relâmpago e planejar a cesta pelo menor custo. A economia depende de as ofertas lidas serem corretas e de haver adesão das lojas.',
    '**Para o bairro:** circulação de renda no comércio local e redução de desperdício de alimentos pelo Salva-Estoque.',
    '**Para a formação do autor:** prática de engenharia de uma plataforma completa (modelagem, concorrência, tempo real, segurança, testes e documentação) aplicada a um problema real de comunidade.',
  ]),

  h2('Limitações'),
  p('As limitações abaixo vêm da documentação anterior (documento 09, parcialmente desatualizado) e da verificação do código em 23/11/2026.'),
  table('Limitações conhecidas', ['Limitação', 'Detalhe', 'Origem'], [
    ['Sem validação com usuários reais', 'Não há entrevistas, oficinas, teste de usabilidade nem uso por lojas reais registrados', 'Verificação do repositório'],
    ['Cupom é reserva de preço', 'O caixa da rede não está integrado; a baixa depende de parceria com a rede. O modelo de repasse (lucro = base − encarte) não tem acordo comercial registrado', 'Documento 09; código'],
    ['Leitura de ofertas só de HTML e texto', 'Sites montados por JavaScript exigiriam navegador headless; redes que bloqueiam robôs dependem do envio de encarte', 'Documento 09'],
    ['Envio de encarte sem tela', 'O upload de PDF ou imagem existe só na API; o cadastro estruturado funciona pelo MCP', 'Documento 09; código'],
    ['PDV, abertura de loja e encartes sem tela', 'API existe e é testada, mas o painel não tem interface', 'Código'],
    ['Sem integração com o caixa', 'Também vale para o PDV de balcão e para o estoque (inexistente por decisão)', 'Decisão de 20/11/2026'],
    ['WhatsApp só por link', '`wa.me` aberto pelo usuário; não há envio automático', 'Código'],
    ['Entrega e rotas dependem de serviços externos', 'OSRM público (com estimativa de reserva por linha reta); o pool de entregadores precisa de cadastro e confiança', 'Código; doc. 10'],
    ['Sem implantação pública', 'Nenhum ambiente de produção confirmado; planos de hospedagem a conferir', 'Cap. 11'],
    ['Segurança e LGPD parciais', 'PIN em texto, limite de taxa em memória, sem exclusão de conta nem política de privacidade publicada', 'Cap. 10'],
    ['Front sem testes automatizados', 'Nem build do front foi executado nesta verificação', 'Cap. 10'],
    ['Observabilidade mínima', 'Logs em texto, sem métricas, tracing ou alertas', 'Cap. 11'],
    ['Dados legados no schema', 'Colunas e objetos do estoque e da Rede B2B ainda existem por compatibilidade', 'Cap. 6'],
  ], { w: [0.28, 0.5, 0.22], size: 'xs', key: 'limites' }),
  box('Itens do documento 09 que já não valem', [
    'O documento 09 afirma que o front usa o bairro fixo "Aldeota" até haver seleção de endereço; a vitrine hoje usa o endereço escolhido pelo usuário. Também diz que "o pedido de entrega ainda não existe", o que ficou desatualizado depois do módulo de logística.',
  ]),

  h2('Trabalhos futuros'),
  table('Trabalhos futuros, em ordem sugerida', ['Prioridade', 'Item', 'Motivo'], [
    ['1', 'Implantar em ambiente público e registrar a URL, o banco e a política de backup', 'Hoje não há implantação confirmada'],
    ['2', 'Piloto com poucas lojas reais do bairro, com termo de consentimento e coleta dos indicadores planejados', 'Sem isso, impacto e adesão não podem ser afirmados'],
    ['3', 'Telas faltantes no painel: PDV, envio de encarte e abertura de loja', 'API pronta e testada'],
    ['4', 'Limpar o schema: remover `stock_qty`, `stock_movements`, `allow_b2b_sharing`, `b2b_reserve_qty`, `v_b2b_surplus` e o `idx_products_b2b`, e o B2B do `seed.sql`', 'Coerência com a decisão de 20/11/2026'],
    ['5', 'Testes automatizados do front, build na integração contínua e teste de carga', 'Qualidade além da API'],
    ['6', 'LGPD: exclusão de conta, exportação de dados e política de privacidade; limite de taxa compartilhado (Redis ou banco)', 'Pré-requisito para usuários reais'],
    ['7', 'Parcerias com redes para baixa do cupom no caixa', 'Fecha o ciclo do cupom e valida o modelo de repasse'],
    ['8', 'Observabilidade: logs estruturados, métricas e alertas', 'Operação sustentável'],
    ['9', 'Reavaliar Next.js após o MVP', 'Decisão adiada em 16/11/2026'],
  ], { w: [0.12, 0.58, 0.3], size: 'sm' }),
]
