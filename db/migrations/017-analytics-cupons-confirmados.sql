-- 017 · Analytics: vendas por cupom confirmado. Idempotente. Aplicada por `npm run migrate` (apps/api).
--
-- O Dashboard Analítico passou a contar como venda o cupom CONFIRMADO pelo cliente (status = 'REDEEMED'),
-- na data de redeemed_at. Índice parcial só com os cupons confirmados (poucos perto do total): a consulta filtra
-- por intervalo semiaberto em redeemed_at e lê no próprio índice tudo o que precisa para somar valor e lucro.
-- Em produção com a tabela grande, rode o CREATE INDEX com CONCURRENTLY, fora de transação.
CREATE INDEX IF NOT EXISTS idx_coupons_redeemed
  ON deal_coupons (redeemed_at)
  INCLUDE (deal_id, customer_id, unit_price, original_price, min_qty)
  WHERE status = 'REDEEMED';
