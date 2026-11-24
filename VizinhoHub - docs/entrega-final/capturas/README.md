# Capturas de tela do VizinhoHub

Capturas feitas em ambiente de desenvolvimento local (API em `localhost:3334`, front em `localhost:5174`, Postgres embutido), com o catálogo importado, as ofertas de demonstração do Salva-Estoque, ~30 dias de vendas de exemplo (`seed-demo-sales`), 3 pedidos de exemplo da cliente de desenvolvimento e 2 ofertas relâmpago de exemplo. Todos os nomes de clientes são dados fictícios de demonstração. Desktop: 1440x900; mobile: 390x844 (escala 2x).

Perfis: **Cliente** = Maria Souza (conta de desenvolvimento); **Comerciante** = Mercadinho do Zé (conta de desenvolvimento); **Visitante/Cliente** = tela pública, capturada já logada como Maria.

| Arquivo | Tela | Rota | Perfil |
|---|---|---|---|
| `01-home.png` | Início da vitrine (página inteira) | `/` | Cliente |
| `02-ofertas.png` | Ofertas (Tá Quentinho, Salva-Estoque, Ofertas do bairro; página inteira) | `/ofertas` | Cliente |
| `03-ofertas-do-bairro.png` | Ofertas do bairro (cupom de retirada) | `/ofertas-do-bairro` | Cliente |
| `04-produtos.png` | Catálogo de produtos | `/produtos` | Cliente |
| `05-produto.png` | Detalhe do produto | `/produto/:id` | Cliente |
| `06-carrinho.png` | Carrinho / finalizar pedido (2 itens, Selo VIP) | `/carrinho` | Cliente |
| `07-radar.png` | Radar Tá Quentinho (ofertas relâmpago) | `/radar` | Cliente |
| `08-receitas.png` | Receitas do Carrinho Inteligente (página inteira) | `/receitas` | Cliente |
| `08b-receita-detalhe.png` | Detalhe de receita (receita para menor custo) | `/receitas/arroz-com-frango` | Cliente |
| `09-acompanhar-pedido.png` | Acompanhamento do pedido em tempo real (status Em preparação) | `/acompanhar/:id` | Cliente |
| `10-conta.png` | Minha conta (pedidos, endereços, dados) | `/conta` | Cliente |
| `11-clube.png` | Clube VIP (Selo Vizinho VIP) | `/clube` | Cliente |
| `12-mobile-home.png` | Início, versão mobile | `/` | Cliente |
| `13-mobile-ofertas.png` | Ofertas, versão mobile | `/ofertas` | Cliente |
| `14-mobile-carrinho.png` | Carrinho, versão mobile | `/carrinho` | Cliente |
| `20-dashboard.png` | Dashboard do comerciante | `/dashboard` | Comerciante |
| `21-analises.png` | Análises da loja (página inteira) | `/dashboard/analytics` | Comerciante |
| `22-kanban.png` | Mural de pedidos (Kanban em tempo real) | `/manager` | Comerciante |
| `23-pedidos.png` | Histórico de pedidos | `/pedidos` | Comerciante |
| `24-meus-produtos.png` | Meus produtos | `/meus-produtos` | Comerciante |
| `25-ofertas-relampago.png` | Ofertas relâmpago (criação e lista) | `/ofertas-relampago` | Comerciante |
| `26-entregas.png` | Entregas | `/entregas` | Comerciante |
| `27-configuracoes.png` | Configurações da loja (página inteira) | `/configuracoes` | Comerciante |

Observações
- No Radar (`07`), o navegador automatizado não tem GPS; por isso aparece o aviso de que a região de referência de Fortaleza foi usada. As ofertas exibidas são de exemplo.
- A tela do entregador (`/entregador`) e demais telas do painel (combos, agenda, caderneta, clientes, relatórios etc.) não foram capturadas nesta rodada.
