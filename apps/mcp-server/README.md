# VizinhoHub MCP Server

Servidor [MCP](https://modelcontextprotocol.io) que deixa o **lojista gerenciar ofertas conversando com a IA** (Claude Desktop, Claude Code ou qualquer cliente MCP). Ele fala com a API do VizinhoHub (`/api/v1`) usando a conta do lojista: o que a IA cria aparece no radar "Tá Quentinho", no prato do dia e nos combos da vitrine.

O servidor (`src/server.ts`) é separado do transporte (`src/index.ts`, stdio), então dá para expor por HTTP no futuro sem mexer nas tools.

## O que a IA consegue fazer (6 tools de ofertas + 2 de panfleto + 2 de consulta das Ofertas do bairro)

| Tool | Para quê |
| --- | --- |
| `buscar_meus_produtos` | Acha produtos do catálogo da loja pelo nome (devolve id, preço, categoria). Toda oferta precisa de um produto existente. |
| `listar_minhas_ofertas` | Lista relâmpagos, prato do dia de hoje e combos, com preços, quantidades, validade (horário de Fortaleza) e status. |
| `criar_oferta` | Cria `relampago`, `prato_do_dia` ou `combo`. |
| `atualizar_oferta` | Muda preço/quantidade/limite/horário de uma relâmpago ativa, ou porções/liga-desliga do prato do dia. Combo não é editável (remover e recriar). |
| `pausar_ou_encerrar_oferta` | Relâmpago: encerra (**definitivo**, não há pausa). Prato do dia: pausa/retoma. Combo: remove. |
| `resumo_vendas_ofertas` | Unidades vendidas por relâmpago, porções do prato do dia e pedidos de hoje com relâmpago. |

### Exemplos de pedidos em linguagem natural

- "Publica uma promoção de rodízio hoje por R$ 39,90 até as 23h, limite de 30 unidades."
  A IA busca o produto "rodízio" (`buscar_meus_produtos`) e chama `criar_oferta` com `tipo: "relampago"`, `precoOferta: 39.9`, `quantidade: 30`, `ate: "23:00"`. Se o produto não existir no catálogo, ela avisa em vez de inventar.
- "Quais ofertas estão no ar agora?" → `listar_minhas_ofertas`.
- "Baixa o preço da relâmpago do creme de leite para R$ 2,50 e aumenta para 40 unidades." → `atualizar_oferta`.
- "Liga o prato do dia: feijoada, 25 porções." → `criar_oferta` com `tipo: "prato_do_dia"`.
- "Pausa o prato do dia até eu voltar" / "Retoma o prato do dia" → `pausar_ou_encerrar_oferta`.
- "Monta um combo de café + pão por R$ 12" → `criar_oferta` com `tipo: "combo"` (mínimo 2 produtos).
- "Encerra a promoção do iogurte" → `pausar_ou_encerrar_oferta` (relâmpago: definitivo).
- "Como estão as vendas das ofertas hoje?" → `resumo_vendas_ofertas`.

### Regras que vale saber

- A oferta **relâmpago dura no máximo 12 h** (mínimo 5 min) e o preço precisa ser **menor** que o do produto. Use `ate` ("HH:MM" de hoje, horário de **Fortaleza, UTC-3**) ou `duracaoMinutos`. Se o horário já passou hoje, a tool devolve erro (não joga para amanhã).
- Relâmpago encerrada **não volta**: crie outra.
- Toda oferta exige um **produto já cadastrado** no catálogo da loja.
- Erros da API (ex.: `OFFER_NOT_CHEAPER`) voltam como resultado de erro da tool, com a mensagem, sem derrubar o servidor.

## Panfleto de ofertas pelo chat (2 tools)

O lojista anexa a foto/PDF do panfleto no chat; o **Claude lê a imagem** e chama o MCP com as ofertas já estruturadas (o servidor não faz OCR nem usa chave de IA). Só o **gerente da rede** pode enviar.

| Tool | Para quê |
| --- | --- |
| `consultar_rede` | Procura a rede por nome ou slug (sem acento/caixa) e devolve slug, quantidade de filiais ativas e as 5 primeiras (nome + bairro). Várias redes casando: lista para escolher; nenhuma: lista as disponíveis. |
| `cadastrar_ofertas_encarte` | Cadastra de 1 a 200 ofertas (`produto`, `categoria`, `unidade`, `precoPor` e opcionais `marca`, `precoDe`, `quantidadeMinimaAtacado`, `relampago`, `entregaPorMoto`, `textoOriginal`) via `POST /deals/flyers/structured`. Opções: `bairro` (panfleto de uma filial), `validadeDias` (1-30, padrão 7), `adicionar` (`true` = mais uma página do mesmo encarte, não apaga as anteriores), `nomeArquivo`. Responde quantas foram cadastradas, quantas foram descartadas e o motivo de cada. |

Exemplo: *"Esse panfleto é do Mercadinho São Luiz, vale por 10 dias."* (com a imagem anexa). O Claude confere a rede com `consultar_rede`, extrai só os itens com preço promocional claro e chama `cadastrar_ofertas_encarte`. Panfleto de várias páginas: uma chamada por página, com `adicionar: true` da segunda em diante. Depois disso o site mostra cada oferta com a filial mais próxima do cliente, a distância e o tempo.

Erros comuns: `NOT_CHAIN_MANAGER` (conta não é gerente da rede), `CHAIN_NOT_FOUND` e `NO_VALID_DEALS` (todas as ofertas descartadas; a mensagem traz o motivo de cada uma).

## Ofertas do bairro: consulta (2 tools, só leitura)

Para o chat **explicar e conferir** a vitrine dos supermercados que o cliente vê em `/ofertas-do-bairro` (e na página Produtos). Não são as ofertas da loja do lojista (essas são `listar_minhas_ofertas`) e nenhuma delas cria ou confirma cupom.

| Tool | Para quê |
| --- | --- |
| `listar_ofertas_do_bairro` | Lista as promoções vigentes dos supermercados/atacarejos (`GET /deals`, maior desconto primeiro, só o que foi visto nas últimas 24 h). Filtros opcionais: `busca`, `bairro` (inclui as ofertas da rede toda), `rede` (nome ou slug, resolvido como em `consultar_rede`), `categoria`, `apenasCupom` (desconto ≥ 15 %), `apenasRelampago`, `limite` (1-50, padrão 20). Cada oferta traz rede, produto, preço de/por, % de desconto, unidade, atacarejo, bairro, se é relâmpago / gera cupom / tem entrega por moto e `foto`. |
| `listar_meus_cupons` | Lista os cupons de retirada que a **conta conectada** reservou como cliente (`GET /coupons/mine`): código, produto, preço reservado, economia, rede, validade em horário de Fortaleza e status (`ativo`, `compra confirmada`, `vencido`). Filtro `status`. O lucro do VizinhoHub nunca é devolvido. |

- `foto` é o caminho da imagem no site (`/img/...`), tirada do produto de nome mais parecido do catálogo: é uma **aproximação** (pode ser de outra marca). `null` = sem foto.
- Perguntas que elas respondem: "o que está em oferta na Aldeota?", "tem leite em promoção no São Luiz?", "só as que dão cupom", "o encarte que cadastrei apareceu?", "quais cupons eu tenho ativos?".
- Cupom só nasce quando o **cliente** reserva uma oferta com desconto de 15 % ou mais; conta de lojista sem reservas devolve lista vazia.

## Pré-requisitos

1. API do VizinhoHub rodando (padrão `http://localhost:3333`).
2. Dependências instaladas:

```bash
cd packages/contracts && npm install
cd ../../apps/mcp-server && npm install
```

## Variáveis de ambiente

| Variável | Descrição |
| --- | --- |
| `VIZINHOHUB_API_URL` | URL base da API (padrão `http://localhost:3333`). |
| `VIZINHOHUB_API_TOKEN` | JWT fixo do lojista. **Ou** use o par abaixo. |
| `VIZINHOHUB_EMAIL` + `VIZINHOHUB_PASSWORD` | O servidor faz `POST /auth/login` na primeira chamada, guarda o JWT em memória e, ao receber 401, entra de novo uma vez e repete a chamada. |

Sem token e sem e-mail/senha o servidor não inicia (erro claro no stderr).

## Claude Desktop (Windows)

Edite `%APPDATA%\Claude\claude_desktop_config.json` e reinicie o Claude Desktop:

```json
{
  "mcpServers": {
    "vizinhohub": {
      "command": "npx",
      "args": ["tsx", "C:/Users/Usuário/Desktop/Unifor/projetos/VizinhoHub/apps/mcp-server/src/index.ts"],
      "env": {
        "VIZINHOHUB_API_URL": "http://localhost:3333",
        "VIZINHOHUB_EMAIL": "ze@vizinhohub.test",
        "VIZINHOHUB_PASSWORD": "vizinho123"
      }
    }
  }
}
```

> `ze@vizinhohub.test` / `vizinho123` são credenciais do **seed**, só para ambiente local.

Testado: o caminho com acento (`Usuário`) funciona com `npx tsx <caminho absoluto>`. Se o seu ambiente reclamar do acento, alternativas:

- Rodar pelo Node com o loader do tsx do próprio projeto (o primeiro argumento aponta para o tsx instalado):
  `"command": "node", "args": ["--import", "file:///C:/Users/Usu%C3%A1rio/Desktop/Unifor/projetos/VizinhoHub/apps/mcp-server/node_modules/tsx/dist/loader.mjs", "C:/Users/Usuário/Desktop/Unifor/projetos/VizinhoHub/apps/mcp-server/src/index.ts"]`
- Ou copiar o projeto para um caminho sem acento.

Observação: fora da pasta do projeto, o `npx tsx` pode baixar o `tsx` na primeira execução (alguns segundos). Para evitar, aponte `command` para `.../apps/mcp-server/node_modules/.bin/tsx.cmd` e use só o caminho do `index.ts` em `args`.

## Claude Code

```bash
claude mcp add vizinhohub \
  --env VIZINHOHUB_API_URL=http://localhost:3333 \
  --env VIZINHOHUB_EMAIL=ze@vizinhohub.test \
  --env VIZINHOHUB_PASSWORD=vizinho123 \
  -- npx tsx "C:/Users/Usuário/Desktop/Unifor/projetos/VizinhoHub/apps/mcp-server/src/index.ts"
```

## Desenvolvimento

```bash
npm run typecheck   # tsc --noEmit
npm test            # sobe Postgres embutido + API de teste e conversa com o servidor por transporte em memória
npm start           # stdio (stdout é o protocolo MCP: nunca use console.log; logs só em stderr)
```

## Segurança

- Use o **token ou a conta do próprio lojista**: o servidor age com as permissões dele (papel `MERCHANT`) e só enxerga/altera a loja dele.
- As credenciais do seed são **só para ambiente local**. Nunca coloque senha real em arquivos versionados.
- Contra produção, use uma **conta de teste** e, de preferência, `VIZINHOHUB_API_TOKEN` com validade curta em vez de e-mail/senha no arquivo de configuração.
- As tools criam, alteram e encerram ofertas de verdade: confira o que a IA vai fazer antes de aprovar a chamada.
