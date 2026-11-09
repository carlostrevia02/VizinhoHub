-- Índices do Dashboard Analítico do comerciante (GET /api/v1/analytics/dashboard).
-- Bancos novos já recebem isto pelo db/schema.sql. Idempotente. Uso: npm run migrate (em apps/api).
--
-- Em produção com tabelas grandes, rode cada CREATE INDEX com CONCURRENTLY, fora de transação
-- (psql -f, um comando por vez), para não bloquear a escrita de pedidos.
--
-- Todas as consultas do painel filtram por  merchant_id = ? AND created_at >= ? AND created_at < ?
-- (intervalo semiaberto sobre a coluna "crua", para o índice ser usável) e leem só status,
-- total_price e payment_method. O índice abaixo traz essas colunas no INCLUDE: os KPIs, as vendas
-- por hora e os métodos de pagamento viram Index Only Scan, sem tocar na tabela.
CREATE INDEX IF NOT EXISTS idx_orders_merchant_created_cover
  ON orders (merchant_id, created_at)
  INCLUDE (status, total_price, payment_method);

-- Curva ABC: junta os itens dos pedidos do período e soma quantity * unit_price por produto.
-- O UNIQUE (order_id, product_id) já indexa order_id, mas obriga a ir à tabela buscar quantidade e preço.
CREATE INDEX IF NOT EXISTS idx_order_items_order_cover
  ON order_items (order_id)
  INCLUDE (product_id, quantity, unit_price);

-- Conversão de encartes: oferta -> cupons reservados/retirados. Antes só havia índice por cliente.
CREATE INDEX IF NOT EXISTS idx_coupons_deal
  ON deal_coupons (deal_id)
  INCLUDE (status, created_at);

-- Ofertas lidas de um encarte, por fonte e data da leitura (uq_deals_identity começa por source_id,
-- mas não cobre last_seen_at).
CREATE INDEX IF NOT EXISTS idx_deals_source_seen
  ON deals (source_id, last_seen_at);

-- Encartes enviados com sucesso por comerciante e data (idx_flyer_uploads_uploader cobre uploader_id + created_at;
-- este parcial é menor e já exclui PROCESSING/FAILED).
CREATE INDEX IF NOT EXISTS idx_flyer_uploads_ok
  ON flyer_uploads (uploader_id, created_at)
  INCLUDE (source_id)
  WHERE status = 'SUCCESS';

-- Volumes muito grandes (dezenas de milhões de pedidos): considere particionar `orders` por mês
-- (PARTITION BY RANGE (created_at)) ou, no mínimo, trocar o 1º índice por um BRIN em created_at.
