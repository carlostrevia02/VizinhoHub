# Coleção do Thunder Client

Arquivos de exportação (formato Thunder Client 1.2):
- `vizinhohub.collection.json` — 7 pastas, 41 requests, com testes de status e de corpo.
- `vizinhohub.environment.json` — variáveis `host`, `baseUrl`, tokens e IDs.

## Importar
1. Thunder Client → **Collections** → ⋯ → **Import** → `vizinhohub.collection.json`.
2. **Env** → ⋯ → **Import** → `vizinhohub.environment.json`, e marque o ambiente **VizinhoHub local** como ativo.

## Subir a API
```bash
cd apps/api
npm run dev:db     # Postgres local (sem Docker) — deixe rodando
npm run import-catalog   # 1ª vez: 437 produtos do catálogo para a loja do Zé
npm run dev        # API em http://localhost:3333
```
(Com Docker: `docker compose up -d` na raiz no lugar de `npm run dev:db`.)

## Usar
Rode as pastas **em ordem** (ou a coleção inteira com **Run All**). Os logins gravam `tokenZe`, `tokenLucia` e `tokenMaria` no ambiente; os requests seguintes usam esses tokens, e `productId`, `newProductId` e `orderId` são preenchidos pelas respostas.

Usuários do seed (senha `vizinho123`, só para desenvolvimento): `ze@vizinhohub.test` e `lucia@vizinhohub.test` (comerciantes), `maria@vizinhohub.test` (cliente).

Observações:
- **Cadastrar cliente** devolve 201 na 1ª vez e 409 nas seguintes (o e-mail já existe) — por isso não tem teste de status.
- **Login com Firebase**: cole um ID token real (no front: `await auth.currentUser.getIdToken()`) na variável `firebaseIdToken`; com o valor padrão a resposta esperada é 401.
- O fluxo de pedido consome estoque do Creme de Leite (3 un. por rodada); para repor, use **Entrada de estoque** ou recrie o banco apagando `apps/api/.pgdata`.
