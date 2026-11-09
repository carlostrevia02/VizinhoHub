# 09 — Ofertas do Bairro

Inovação 3: a vitrine mostra as promoções dos supermercados de Fortaleza ("o leite está em oferta no São Luiz") e o cliente reserva a oferta num **cupom de retirada** para apresentar no caixa da rede.

## Fluxo

```
deal_sources (URLs cadastradas)
   └─► job a cada hora (apps/api/src/shared/jobs.ts → deals.scanner.ts)
         1. baixa a página (respeita robots.txt) e converte HTML → texto
         2. mesmo SHA-256 da última leitura? → só renova as ofertas, NÃO chama o modelo
         3. Claude extrai as ofertas em JSON (prompt em deals.extractor.ts)
         4. parseExtraction valida item a item e RECALCULA percentual e elegibilidade
         5. upsert em `deals`; o que saiu da página é desativado
   └─► GET /deals · POST /deals/:id/coupon · GET /coupons/mine
```

## Regras que o servidor garante (não confia no modelo)

| Regra | Onde |
|---|---|
| `discount_pct = round((de − por) / de · 100)`; sem preço "de" → `null` | `parseExtraction` |
| `coupon_eligible` = desconto ≥ 15 % | `COUPON_MIN_PCT` |
| "por" ≥ "de", desconto > 90 % ou categoria/unidade fora da lista → oferta descartada | `parseExtraction` |
| Página sem nenhuma oferta → status `EMPTY`, não apaga as ofertas existentes | `deals.scanner.ts` |
| Oferta não vista há mais de 24 h some da API | `LIVE` em `deals.repository.ts` |
| Um cupom ativo por cliente e oferta; vale 24 h; guarda o preço da reserva | `uq_coupons_active`, `COUPON_TTL_HOURS` |
| Varredura única mesmo com várias instâncias da API | `pg_try_advisory_lock` |

O conteúdo das páginas é tratado como **dado não confiável** (o prompt manda ignorar instruções dentro dele, e a saída é restrita pelo schema).

## Endpoints (base `/api/v1`)

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/deals?search=&neighborhood=&chain=&category=&couponEligible=&flash=&limit=&offset=` | público | Ofertas vigentes, maior desconto primeiro. `neighborhood` inclui as ofertas da rede toda (sem bairro). |
| GET | `/deals/chains` | público | As 19 redes com a contagem de ofertas vigentes. |
| GET | `/deals/:id` | público | Uma oferta. |
| POST | `/deals/:id/coupon` | login | Gera o cupom (`201`); `409` já tem ativo, `422` oferta sem cupom, `404` encerrada. |
| GET | `/coupons/mine` | login | Cupons do cliente (vencidos aparecem como `EXPIRED`). |

## Operação

1. Aplicar o schema: banco novo já vem pronto; banco existente → `db/migrations/001-ofertas-do-bairro.sql`.
2. Cadastrar as páginas a ler (a URL é decisão editorial — confira os termos de uso e o robots.txt de cada rede):
   ```sql
   INSERT INTO deal_sources (chain_id, url, neighborhood)
   SELECT id, 'https://…/ofertas', 'Aldeota' FROM retail_chains WHERE slug = 'sao-luiz';
   ```
3. No `.env`: `ANTHROPIC_API_KEY` (sem ela o job fica desligado). Opcionais: `DEALS_MODEL` (padrão `claude-opus-5-5`), `DEALS_SCAN_INTERVAL_MIN` (60), `DEALS_USER_AGENT`.
4. Varredura manual: `npm run scan-deals` em `apps/api`. Estado de cada fonte: `deal_sources.last_status` / `last_error`.

## Envio de encarte (imagem/PDF)

Para redes que bloqueiam robôs ou só publicam encarte em imagem/PDF, o gerente da rede (ou um parceiro autorizado) envia o arquivo e o Claude lê a imagem direto, com o mesmo prompt, as mesmas validações e o mesmo `saveDeals` do job.

```bash
curl -X POST "http://localhost:3333/api/v1/deals/flyers?chain=sao-luiz&neighborhood=Aldeota&validDays=7" \
  -H "Authorization: Bearer $TOKEN" --data-binary @encarte.pdf        # 202 + { id, status: "PROCESSING" }
curl http://localhost:3333/api/v1/deals/flyers/<id> -H "Authorization: Bearer $TOKEN"   # PROCESSING → SUCCESS | FAILED
```

- O corpo é o próprio arquivo (PDF até 20 MB; JPEG/PNG/WebP até 5 MB). O tipo é conferido pelos bytes, não pelo `Content-Type`.
- Parâmetros: `chain` (slug, obrigatório), `neighborhood`, `validDays` (1–30, padrão 7: as ofertas valem até lá), `append=true` (página 2 do mesmo encarte: não apaga as ofertas da página 1; sem isso o encarte novo substitui o anterior da mesma rede+bairro).
- A resposta é imediata (202); a leitura roda em segundo plano. `GET /deals/flyers` lista os seus envios.
- **Quem pode enviar:** só comerciante (`users.role = 'MERCHANT'`) cadastrado como gerente da rede. Sem isso, qualquer comerciante publicaria ofertas falsas em nome de uma rede (e geraria cupons):
  ```sql
  INSERT INTO retail_chain_managers (chain_id, user_id)
  SELECT c.id, u.id FROM retail_chains c, users u WHERE c.slug = 'sao-luiz' AND u.email = 'gerente@exemplo.com';
  ```
- O arquivo não é guardado; só o que foi extraído dele (`flyer_uploads`, para auditoria). Sem `ANTHROPIC_API_KEY` a rota responde 501.

## Limitações atuais

- O job lê só HTML/texto. Sites que montam tudo por JavaScript precisam de navegador headless.
- Não há tela de envio ainda: o upload é só pela API (a conta de comerciante do Firebase precisa existir também como `MERCHANT` na API).
- O cupom é uma **reserva de preço**: o caixa da rede não está integrado, então a validação/baixa (`REDEEMED`) depende de parceria com a rede.
- Entrega por motoboy: `delivery_eligible` só marca a oferta; o pedido de entrega ainda não existe.
- O frontend usa o bairro fixo "Aldeota" (o mesmo do cabeçalho da loja) até haver seleção de endereço.

Related: [05 — Modelagem de Dados](05-modelagem-de-dados.md) · [06 — Contrato da API](06-contrato-api.md) · [02 — Fluxo do Usuário](02-fluxo-do-usuario.md)
Up: [Índice da documentação](README.md)
