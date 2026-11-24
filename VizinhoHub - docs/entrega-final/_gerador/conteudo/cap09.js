'use strict'
const { h1, h2, h3, p, ul, table, fig, shot, box } = require('../modelo')
const F = require('./fatos')

const NOTA = ' Capturada em ambiente de desenvolvimento com dados de demonstração (seed).'
const sl = (file, caption, o = {}) => fig(file, caption, { dir: 'fatias', ...o })

module.exports = () => [
  h1('Interface'),
  p(`O front é um único aplicativo React (\`apps/web\`) com **${F.telas} telas** por rota, divididas em três áreas: a **vitrine** pública do cliente (Store), a área do **entregador** e o **painel do comerciante** (Manager), protegido por papel. A interface é mobile-first e instalável como PWA.`),
  box('Sobre as capturas', [
    'Todas as capturas foram feitas em ambiente de desenvolvimento local (API em `localhost`, Postgres embutido), com o catálogo importado, ofertas de demonstração, cerca de 30 dias de vendas de exemplo (`seed-demo-sales`), pedidos de exemplo e duas ofertas relâmpago de exemplo. **Nomes de clientes, valores de faturamento, quantidades e contagens exibidos são dados fictícios de demonstração**, não de uso real. Desktop em 1440x900; mobile em 390x844.',
    'A tela do entregador (`/entregador`) e várias telas do painel (combos, agenda, caderneta, clientes, relatórios) não foram capturadas nesta rodada.',
  ], { kind: 'warn' }),

  h2('Mapa de telas'),
  fig('17-mapa-de-telas', 'Mapa de telas, a partir das rotas reais de `apps/web/src/App.jsx`.'),
  p('O mapa agrupa as rotas por área. Na vitrine: início, produtos, ofertas, ofertas do bairro, radar, receitas, lista de compras, carrinho, acompanhamento do pedido, conta e Clube VIP. No painel: dashboard, análises, mural de pedidos (Kanban), histórico, entregas, produtos, ofertas relâmpago, Clube VIP, caderneta, agenda, prato do dia, combos, clientes, relatórios e configurações. O painel não tem mais telas de estoque, Departamentos ou Encartes (decisão de 20/11/2026).'),

  h2('Vitrine do cliente (desktop)'),
  sl('01-home-topo', 'Início da vitrine (recorte do topo da página inteira).' + NOTA + ' A contagem de produtos exibida é a do banco de desenvolvimento no momento da captura.', { maxH: 720 }),
  p('**Comentários de usabilidade.** O topo reúne busca, navegação principal e carrinho com contador, sempre visíveis. A chamada principal ("Ver todos os produtos" e "Ver as ofertas") está logo acima da dobra, e a seção "Compre por departamento" usa círculos com a foto de um produto de cada departamento, o que acelera o reconhecimento. Ponto de atenção: algumas imagens de departamento mostram produtos que não representam bem o departamento (por exemplo, um único item de doce), por serem escolhidas do catálogo importado.'),
  shot('03-ofertas-do-bairro', 'Ofertas do bairro: filtros e cartões com preço "de" e "por", selo de desconto e botão "Pegar cupom de retirada".' + NOTA, { maxH: 520, w: 0.85 }),
  p('**Comentários.** Os filtros (busca, rede, "só com cupom") e o botão "Usar minha localização" explicam o benefício ("veja a filial mais próxima, a distância e o tempo de moto"). O cartão mostra a rede e o bairro, o preço antigo riscado e o selo "A partir de N un." quando é oferta de atacarejo. Pontos de atenção: várias ofertas aparecem com imagem genérica (ícone de sacola) porque o produto de catálogo parecido não foi encontrado; e a barra flutuante "Meu carrinho" cobre parte dos cartões ao rolar.'),
  shot('04-produtos', 'Catálogo de produtos com busca e filtros.' + NOTA, { maxH: 520, w: 0.85 }),
  shot('06-carrinho', 'Finalizar pedido: carrinho, dados do cliente e forma de pagamento.' + NOTA, { maxH: 520, w: 0.85 }),
  p('**Comentários.** O fluxo é dividido em três etapas visíveis (carrinho, seus dados, confirmação) com barra de progresso, e o resumo mostra a economia do Selo VIP. A opção de pagar na caderneta informa o limite disponível e avisa quando é insuficiente. Ponto de atenção: nas opções de pagamento, os botões de rádio e os rótulos ficam desalinhados no desktop, o que merece ajuste de CSS.'),
  shot('07-radar', 'Radar Tá Quentinho (ofertas relâmpago por perto). O navegador automatizado não tem GPS; a tela usa a região de referência de Fortaleza e avisa disso.' + NOTA, { maxH: 520, w: 0.85 }),
  shot('09-acompanhar-pedido', 'Acompanhamento do pedido em tempo real (status "Em preparação").' + NOTA, { maxH: 520, w: 0.85 }),
  p('**Comentários.** A linha do tempo vertical (recebido, em preparação, pronto, entregue) mostra o estado atual destacado e as próximas etapas como "Em breve"; o texto "atualizamos o status em tempo real" evita que o cliente recarregue a página. O resumo ao lado repete itens, entrega e economia VIP.'),
  shot('11-clube', 'Clube VIP (Selo Vizinho VIP).' + NOTA, { maxH: 520, w: 0.85 }),
  sl('02-ofertas-topo', 'Página de ofertas (recorte do topo): Tá Quentinho, Salva-Estoque e Ofertas do bairro.' + NOTA, { maxH: 700 }),
  sl('08-receitas-topo', 'Receitas do Carrinho Inteligente (recorte do topo da página inteira).' + NOTA, { maxH: 700 }),
  shot('08b-receita-detalhe', 'Detalhe de receita: ingredientes e plano de menor custo entre lojas.' + NOTA, { maxH: 520, w: 0.85 }),
  shot('10-conta', 'Minha conta: pedidos, endereços e dados.' + NOTA, { maxH: 520, w: 0.85 }),

  h2('Vitrine do cliente (mobile)'),
  fig('mobile-trio', 'Versão mobile: início, ofertas e carrinho (390x844).' + NOTA, { dir: 'fatias', maxH: 520 }),
  p('**Comentários.** No celular, a navegação vira ícones (busca, carrinho com contador e menu), a chamada principal ocupa a largura toda e as ofertas aparecem em duas colunas, com a barra fixa "Meu carrinho / Finalizar pedido" ao pé da tela. Pontos de atenção encontrados na inspeção: no carrinho mobile, o nome do produto fica espremido e chega a encostar nos botões de quantidade (o nome quebra em várias linhas); e a barra fixa cobre o preço dos cartões de ofertas ao rolar. Por ser PWA, o aplicativo pode ser instalado na tela inicial e, no iOS, só recebe notificações push depois de instalado (iOS 16.4 ou superior). Não foi realizado teste de usabilidade com usuários; as observações acima são de inspeção do próprio autor.'),

  h2('Painel do comerciante'),
  shot('20-dashboard', 'Dashboard do comerciante: pedidos do dia, faturamento, ticket médio, vendas da semana e por departamento.' + NOTA + ' Os valores do gráfico (inclusive o pico de sexta-feira) vêm do gerador de vendas de demonstração.', { maxH: 520, w: 0.85 }),
  p('**Comentários.** O dashboard abre com três números do dia e dois gráficos. A barra lateral agrupa as áreas (visão geral, catálogo, ofertas, vendas do bairro), com um selo vermelho de pedidos pendentes sobre "Pedidos (Kanban)". O aviso "ative o som do caixa" aparece em todas as telas porque o navegador só toca o alerta depois de um gesto do usuário; é uma limitação do navegador, tratada com o botão visível.'),
  shot('22-kanban', 'Mural de pedidos (Kanban em tempo real): colunas Novos, Em preparação e Prontos/Entregues.' + NOTA + ' A coluna "Em Preparação" acumula pedidos de exemplo gerados pelo seed.', { maxH: 520, w: 0.85 }),
  p('**Comentários.** Cada cartão traz número, cliente, itens, forma de retirada, telefone, barra de progresso ("Etapa 2 de 4"), total e as ações **Avançar status** e **Cancelar**, que seguem a máquina de estados do pedido. O indicador "Tempo real" no topo mostra a conexão do WebSocket. Pontos de atenção: os links do cabeçalho do painel ("Ver vitrine", "Minha loja", "Sair") ficam muito espaçados no desktop; e com muitos pedidos acumulados a coluna do meio fica longa, o que sugere um filtro por data.'),
  shot('25-ofertas-relampago', 'Ofertas relâmpago: formulário de criação e lista das ofertas do comerciante.' + NOTA, { maxH: 520, w: 0.85 }),
  p('**Comentários.** O formulário mostra os limites de cada campo no rótulo (quantidade de 1 a 1.000, máximo por cliente de 1 a 20, raio de 100 a 10.000 m, duração de 5 a 720 min), o que reduz erro de digitação, e a tabela mostra vendidas, restantes, tempo e status. O mesmo cadastro pode ser feito conversando com a IA pelo servidor MCP.'),
  shot('24-meus-produtos', 'Meus produtos.' + NOTA, { maxH: 520, w: 0.85 }),
  shot('23-pedidos', 'Histórico de pedidos.' + NOTA, { maxH: 520, w: 0.85 }),
  shot('26-entregas', 'Entregas.' + NOTA, { maxH: 520, w: 0.85 }),
  sl('21-analises-1', 'Análises da loja (parte 1 de 2).' + NOTA, { maxH: 700 }),
  sl('21-analises-2', 'Análises da loja (parte 2 de 2).' + NOTA, { maxH: 700 }),
  shot('27-configuracoes', 'Configurações da loja (página inteira): endereço, horários, entrega, retirada, pagamentos e chave Pix.' + NOTA, { maxH: 760 }),
  p('**Comentários gerais.** A consistência visual (verde da marca, cartões arredondados, barra lateral fixa) facilita a aprendizagem, e os rótulos usam o vocabulário do comerciante. Limitações conhecidas: não há tela para o PDV de balcão, para o envio de encartes nem para a abertura de loja a partir de uma conta de cliente (a API existe, a tela não); e não houve validação com comerciantes reais.'),
]
