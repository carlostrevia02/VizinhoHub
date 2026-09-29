# 🛒 VizinhoHub — Hub do Pequeno Varejo Comunitário

> Plataforma web de vitrine virtual e gestão de estoque em tempo real para micro-comércios de bairro.

## 📌 Sobre o Projeto
O **VizinhoHub** é um projeto de extensão universitária desenvolvido para a disciplina de Desenvolvimento de Plataformas Web do Centro de Ciências Tecnológicas da **Universidade de Fortaleza (Unifor)**.

A plataforma busca digitalizar o pequeno varejo comunitário de Fortaleza, conectando comerciantes locais aos moradores do bairro de forma direta, sem cobrança de taxas abusivas de intermediação.

## 🎯 Desafios Técnicos de Engenharia
- **Notificações em Tempo Real:** comunicação via **WebSockets** para atualização instantânea do painel de pedidos do comerciante.
- **Integridade Transacional de Estoque:** prevenção de *race conditions* na venda simultânea de itens escassos.
- **Arquitetura Limpa:** organização desacoplada do backend (*Clean Architecture / Layered Architecture*).

## 🛠️ Tech Stack Planejada
- **Frontend:** HTML, CSS e JavaScript (fase atual; migração para Next.js/React planejada)
- **Backend:** Node.js (NestJS / Express) ou Python (FastAPI)
- **Banco de Dados:** PostgreSQL + Prisma ORM / Drizzle ORM
- **Infraestrutura:** Docker & Docker Compose

## 📚 Documentação
- [01 — Visão Geral](01-visao-geral.md)
- [02 — Fluxo do Usuário](02-fluxo-do-usuario.md)
- [03 — Wireframes](03-wireframes.md)
- [04 — Arquitetura e Stack](04-arquitetura-e-stack.md)
- Slides: `VizinhoHub-Etapa1.pptx`
