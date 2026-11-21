-- 019 · Fim do estoque de produto.
-- Idempotente. Aplicada por `npm run migrate` (apps/api).
--
-- O VizinhoHub não tem filial nem mercadoria própria: é só um intermediário de descontos de supermercados do
-- bairro. Produto nunca "esgota" nem tem saldo, então o estoque deixou de existir na aplicação: sem baixa ao
-- aceitar o pedido, sem devolução ao cancelar, sem ajuste manual, sem livro-razão (stock_movements não é mais
-- escrita) e sem erro INSUFFICIENT_STOCK. Seguem valendo só os limites DA OFERTA (relâmpago e prato do dia).
--
-- A coluna products.stock_qty FICA apenas por compatibilidade com views, funções e índices antigos que ainda a
-- citam (v_storefront_products, v_canonical_offers, product_available, índice parcial de clearance, etc.).
-- Ela passa a ser um valor fixo e alto, para que nenhum produto (inclusive os novos) suma da vitrine por
-- "stock_qty > 0". O código da aplicação NUNCA lê nem escreve stock_qty: os INSERTs de produto usam o DEFAULT.
ALTER TABLE products ALTER COLUMN stock_qty SET DEFAULT 1000000;
UPDATE products SET stock_qty = 1000000 WHERE stock_qty <> 1000000;
