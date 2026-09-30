# Estrutura do Repositório

```
vizinho-hub/
├── apps/
│   ├── web/                    # Protótipo HTML + CSS (455 páginas)
│   │   ├── index.html … configuracoes.html
│   │   ├── produto-<id>.html   # 437 páginas de detalhe
│   │   ├── css/                # style.css · motion.css · pages.css
│   │   └── img/                # 440 imagens de produtos (+ CREDITS.md)
│   └── api/                    # Core API (planejada — Node.js)
│       └── src/{modules,shared}
├── VizinhoHub - docs/          # Documentação (cofre Obsidian), DER, slides e documento técnico
├── docker-compose.yml          # PostgreSQL local
├── .env.example
└── README.md
```

## Como rodar o protótipo
```bash
python -m http.server 8080 --directory apps/web
```
Acesse http://localhost:8080 (a configuração `.vscode/launch.json` já aponta para essa porta). Abrir o `index.html` direto no navegador também funciona, mas a animação de saída entre páginas (View Transitions) exige HTTP.

## Como subir o banco
```bash
docker compose up -d
```
O `schema.sql` é aplicado automaticamente na primeira inicialização.

## Checklist
- [x] Repositório `vizinho-hub` criado e ligado à pasta do projeto
- [x] `docker-compose.yml` com PostgreSQL
- [x] DER (Mermaid em `05-modelagem-de-dados.md` e imagem `der.svg`)
- [x] Contrato da API e estrutura de pastas
- [x] Protótipo de alta fidelidade (HTML + CSS) do cliente e do comerciante
- [ ] Core API (REST + WebSocket)
- [ ] Migração do frontend para Next.js
