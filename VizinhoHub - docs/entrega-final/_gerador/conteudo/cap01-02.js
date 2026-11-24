'use strict'
const { h1, h2, h3, p, ul, ol, table, fig, box } = require('../modelo')
const F = require('./fatos')

module.exports = () => [
  // ------------------------------------------------------------------ 1
  h1('Resumo executivo'),
  p('O **VizinhoHub** é uma plataforma web gratuita que reúne, em um só lugar, as ofertas dos supermercados e mercadinhos do bairro (o recorte inicial é Fortaleza, CE) e oferece ao pequeno comerciante um painel simples para receber e gerir pedidos em tempo real. Foi desenvolvida como projeto de extensão universitária na disciplina de Desenvolvimento de Plataformas Web (Unifor, 2026.2), por um único autor.'),
  p('O problema que o projeto enfrenta tem três partes: as promoções do bairro ficam dispersas em encartes e mensagens e o morador não sabe onde está o melhor preço perto de casa; o comerciante depende de cadernos e planilhas que não se comunicam com o catálogo público; e os marketplaces tradicionais impõem comissões ou mensalidades difíceis de sustentar para o microempreendedor.'),
  p('A solução é composta por cinco componentes: a vitrine pública (**Store**), o painel do comerciante (**Manager**), a **Core API** REST com canal WebSocket, o banco **PostgreSQL** e um **servidor MCP** que permite ao lojista gerenciar ofertas conversando com uma IA. O VizinhoHub é deliberadamente um **intermediário de descontos**: não mantém filial, mercadoria própria nem estoque de produtos. Só as ofertas de quantidade limitada (relâmpago e prato do dia) têm saldo, e esse saldo é baixado de forma atômica, de modo que a mesma unidade nunca é vendida duas vezes.'),
  h2('Entregas verificáveis no repositório'),
  table('Números do repositório em 23/11/2026', ['Indicador', 'Valor', 'Fonte'], [
    ['Commits (autor único)', `${F.commits}, em ${F.diasComCommit} dias distintos (${F.primeiroCommit} a ${F.ultimoCommit})`, '`git log`'],
    ['Tabelas / índices / migrações', `${F.tabelas} tabelas, ${F.indices} índices, ${F.migracoes} arquivos de migração`, '`db/schema.sql`, `db/migrations`'],
    ['API', `${F.operacoes} operações REST em ${F.rotas} rotas (${F.grupos} grupos), ${F.modulosApi} módulos`, '`openapi.yaml`, `apps/api/src/modules`'],
    ['Telas (React)', `${F.telas} páginas: vitrine, painel do comerciante e área do entregador`, '`apps/web/src/App.jsx`'],
    ['Catálogo importável', `${F.produtosBase} produtos + ${F.produtosAmpliacao.toLocaleString('pt-BR')} da ampliação, em ${F.departamentos} departamentos`, '`db/catalog`'],
    ['Redes de supermercado monitoradas', `${F.redes}`, '`retail_chains` em `schema.sql`'],
    ['Testes automatizados', `${F.testesApi} na API (${F.suitesApi} suítes), ${F.testesMcp} no servidor MCP e ${F.testesContratos} nos contratos; os ${F.testesApi + F.testesMcp + F.testesContratos} passaram na execução de 23/11/2026`, '`apps/api/test`'],
    ['Código', `API ${F.linhasApi} linhas (+ ${F.linhasTestesApi} de testes), front (JS/JSX) ${F.linhasWeb}, MCP ${F.linhasMcp}, contratos ${F.linhasContratos}, SQL ${F.linhasSql}`, '`git ls-files`'],
  ], { w: [0.26, 0.5, 0.24], size: 'sm' }),
  h2('Estado do projeto'),
  p('Os requisitos funcionais levantados neste relatório foram classificados como Implementado, Parcial ou Planejado depois de conferência no código (capítulo 4). A maior parte do escopo está implementada e coberta por testes de integração. Ficam como parciais ou planejados itens que dependem de terceiros ou de decisão de negócio: baixa do cupom diretamente no caixa da rede, tela de envio de encartes, tela de venda no balcão (PDV) e abertura de loja pela interface.'),
  box('Pontos a confirmar pelo autor', [
    '**Número real de beneficiários.** A estimativa de 32 pessoas (2 comerciantes + cerca de 30 moradores de teste) não pôde ser verificada no repositório; ele só registra 2 lojas e 1 cliente de desenvolvimento (seed) e dados de demonstração.',
    '**Entrevistas e oficinas com a comunidade.** Não há registro de entrevistas, oficinas ou questionários no repositório. As personas e histórias deste relatório são arquétipos construídos a partir da documentação do projeto, não resultados de pesquisa de campo.',
    '**Feedback e resultados de uso.** Não existem, no repositório, resultados de feedback, métricas de uso real nem depoimentos. Nenhum número de usuários reais é afirmado neste relatório.',
    '**Validação com comerciantes reais.** O objetivo específico 7 (colocar em produção e validar com comerciantes do bairro) não pôde ser comprovado: há blueprint e scripts de implantação, mas não há URL de produção no repositório (sem implantação pública confirmada) nem evidência de uso por lojistas reais.',
    '**Fontes citadas de memória.** A faixa de comissões de marketplaces (12% a 25%) vem da documentação inicial do projeto, sem fonte primária; os artigos da Resolução CNE/CES nº 7/2018 devem ser conferidos no texto oficial.',
  ], { kind: 'todo' }),

  // ------------------------------------------------------------------ 2
  h1('Introdução'),
  h2('Contexto'),
  p('O pequeno varejo de bairro (mercearias, mercadinhos, hortifrútis, distribuidores de bebidas) é parte central da economia local de Fortaleza e da rotina de abastecimento das famílias. Esses negócios competem com redes maiores e com marketplaces, mas normalmente operam com ferramentas manuais: caderno de fiado, planilha de preços, mensagens de WhatsApp para divulgar promoções.'),
  p('Ao mesmo tempo, as redes de supermercado publicam suas promoções em encartes e páginas próprias, dispersas e difíceis de comparar. Para o morador, achar o melhor preço do item que precisa significa abrir vários encartes. Para o comerciante pequeno, divulgar uma promoção do dia ou receber pedidos de forma organizada exige um sistema que ele não tem condições de contratar.'),
  p('O VizinhoHub nasce desse encontro: uma vitrine que concentra as ofertas do bairro e uma ferramenta de gestão simples, de custo zero para o lojista, em que o pedido aparece no painel no instante em que é feito.'),
  h2('Problema'),
  p('A documentação do projeto resume o problema em três gargalos:'),
  ol([
    '**Descontos pouco visíveis.** As promoções dos supermercados e mercadinhos ficam espalhadas em encartes e mensagens; o morador não sabe onde está o melhor preço perto de casa.',
    '**Dependência de processos manuais.** Cadernos e planilhas estáticas não se comunicam com o catálogo público do cliente, e o lojista não vê o pedido chegar.',
    '**Barreira de entrada para o e-commerce.** Marketplaces cobram comissões (a documentação inicial cita de 12% a 25%) ou mensalidades inviáveis para o microempreendedor.',
  ]),
  h2('Justificativa'),
  p('Há uma lacuna entre o que o pequeno comerciante precisa (visibilidade, pedidos organizados, controle simples) e o que o mercado oferece (soluções caras ou genéricas). Para a universidade, o projeto é uma oportunidade de aplicar, em um problema real e delimitado, conteúdos de desenvolvimento web: modelagem de dados, API REST, comunicação em tempo real, concorrência, segurança e implantação. Para a comunidade, o ganho esperado é duplo: o morador economiza ao encontrar a oferta certa e o comerciante ganha um canal digital sem intermediação onerosa.'),
  p('A decisão de projeto de ser apenas **intermediário de descontos** (sem estoque, sem mercadoria própria) reduz o risco operacional e o escopo regulatório e mantém o foco no que a plataforma faz melhor: reunir, comparar e entregar informação de preço e organizar pedidos.'),
  h2('Objetivos'),
  h3('Objetivo geral'),
  p('Desenvolver e disponibilizar uma plataforma web gratuita, o VizinhoHub, que concentre as ofertas dos supermercados e mercadinhos do bairro e dê ao pequeno comerciante um painel simples para vender e gerir pedidos em tempo real, ampliando a visibilidade do varejo comunitário de Fortaleza e a economia de quem compra no bairro.'),
  h3('Objetivos específicos'),
  table('Objetivos específicos e onde são tratados', ['#', 'Objetivo específico', 'Situação', 'Onde'], [
    ['1', 'Levantar as dores de comerciantes e moradores', 'Parcial: dores descritas na documentação inicial; sem pesquisa de campo registrada', 'Cap. 2 e 4'],
    ['2', 'Modelar e implementar vitrine pública, painel do comerciante e API com autenticação por perfis', 'Atendido: Store, Manager e Core API com RBAC', 'Cap. 5 a 9'],
    ['3', 'Entregar pedidos em tempo real via WebSocket (Kanban)', 'Atendido: `order:created` e `order:status_updated`, Kanban em `/manager`', 'Cap. 7 e 9'],
    ['4', 'Garantir que ofertas de quantidade limitada nunca sejam vendidas em duplicidade', 'Atendido: `UPDATE` condicional atômico, medido em testes com 6 a 30 transações simultâneas', 'Cap. 7.6'],
    ['5', 'Publicar as ofertas do bairro com cupom de retirada válido por 24 horas', 'Atendido: leitura de encartes, cupom de 24 h e confirmação pelo cliente', 'Cap. 4 e 5'],
    ['6', 'Oferecer análises de vendas e lucro', 'Atendido: painel de Análises com KPIs, canais e lucro dos cupons confirmados', 'Cap. 9'],
    ['7', 'Colocar em produção e validar com comerciantes do bairro', 'Parcial: implantação preparada (Render/Vercel/PM2); validação com lojistas não comprovada no repositório', 'Cap. 11 e 12'],
  ], { w: [0.05, 0.38, 0.4, 0.17], size: 'sm', key: 'obj' }),
  h2('Público-alvo'),
  ul([
    '**Comerciante/operador:** donos de pequenos negócios que gerenciam produtos, ofertas e pedidos.',
    '**Consumidor:** moradores do bairro que consultam ofertas, reservam cupons e fazem pedidos de vizinhança.',
    '**Entregador autônomo:** pessoa que, com perfil próprio, aceita corridas do bairro (módulo de logística).',
    '**Gerente de rede ou parceiro autorizado:** quem pode enviar encartes de uma rede de supermercados.',
  ]),
  h2('Objetivos de Desenvolvimento Sustentável (ODS)'),
  p('O projeto se relaciona com quatro ODS da Agenda 2030 da ONU. A relação descrita abaixo é de contribuição potencial, pelo desenho da solução; não há medição de impacto no repositório.'),
  table('Relação do projeto com os ODS', ['ODS', 'Como o VizinhoHub se relaciona'], [
    ['**8** Trabalho decente e crescimento econômico', 'Dá ao microempreendedor um canal digital gratuito e ferramentas de gestão (pedidos, análises, caderneta), apoiando o crescimento de micro e pequenas empresas.'],
    ['**9** Indústria, inovação e infraestrutura', 'Leva inovação tecnológica (tempo real, PWA, extração de ofertas por IA, servidor MCP) ao varejo de bairro, com custo de entrada zero.'],
    ['**11** Cidades e comunidades sustentáveis', 'Fortalece a economia local e a compra de proximidade: filial mais próxima, retirada e entrega no bairro, ofertas por localização.'],
    ['**12** Consumo e produção responsáveis', 'O Salva-Estoque aplica desconto automático (50% e 30%) a produtos perto do vencimento, estimulando o consumo antes do prazo e reduzindo o desperdício no varejo.'],
  ], { w: [0.3, 0.7], size: 'sm' }),
  h2('Vínculo com a extensão universitária'),
  p('A Resolução CNE/CES nº 7/2018 estabelece as diretrizes para a extensão na educação superior brasileira e a define como atividade integrada à matriz curricular, que promove a interação transformadora entre a instituição e outros setores da sociedade. Entre as diretrizes que orientam a concepção e a prática da extensão estão a interação dialógica, a interdisciplinaridade, a indissociabilidade entre ensino, pesquisa e extensão, o impacto na formação do estudante e o impacto na transformação social. A resolução também prevê que as atividades de extensão componham ao menos 10% da carga curricular dos cursos.'),
  p('O VizinhoHub se enquadra na modalidade de projeto de extensão: aplica conhecimentos da disciplina a um problema da comunidade (o pequeno varejo de bairro), produz uma solução de uso público e gratuito e, ao mesmo tempo, forma o estudante na prática profissional. Os pontos que exigem evidência de interação dialógica com a comunidade (entrevistas, oficinas, validação com lojistas) estão registrados na caixa "Pontos a confirmar pelo autor", no capítulo 1, e na conclusão.'),
]
