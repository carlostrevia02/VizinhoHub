-- 020 · Fim da Rede B2B.
-- Idempotente. Aplicada por `npm run migrate` (apps/api).
--
-- A Rede B2B (busca de excedente entre mercadinhos) saiu do produto junto com o estoque (migração 019).
-- Remove a view, o índice e as duas colunas de products que só ela usava. `products.barcode` FICA: serve para
-- vincular o produto ao item canônico do Carrinho Inteligente.
DROP VIEW  IF EXISTS v_b2b_surplus;
DROP INDEX IF EXISTS idx_products_b2b;
ALTER TABLE products
  DROP COLUMN IF EXISTS allow_b2b_sharing,
  DROP COLUMN IF EXISTS b2b_reserve_qty;
