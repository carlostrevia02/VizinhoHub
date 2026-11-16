-- 012 · Ajustes da Caderneta, Encomendas, Combos e Prato do Dia.
-- Idempotente. Aplicada por `npm run migrate` (apps/api).
--
-- Disponibilidade "efetiva" de um produto para a vitrine e para a conferência do pedido:
--   ITEM          → products.stock_qty
--   COMBO         → quantos combos dá para montar com o estoque dos componentes (menor razão estoque/quantidade)
--   DAILY_SPECIAL → qty_available do cardápio de hoje (0 se desligado ou sem linha para hoje)
-- A baixa de verdade continua atômica: componentes no aceite (`stock_qty >= q`) e prato do dia na criação
-- do pedido (`UPDATE daily_menu ... WHERE is_on AND qty_available >= q`).
CREATE OR REPLACE FUNCTION combo_available(p_combo UUID) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(MIN(CASE WHEN c.active THEN c.stock_qty / ci.quantity ELSE 0 END), 0)::int
    FROM combo_items ci JOIN products c ON c.id = ci.component_id
   WHERE ci.combo_id = p_combo
$$;

CREATE OR REPLACE FUNCTION daily_available(p_product UUID) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT CASE WHEN is_on THEN qty_available ELSE 0 END
                     FROM daily_menu WHERE product_id = p_product AND menu_date = current_date), 0)
$$;

CREATE OR REPLACE FUNCTION product_available(p_id UUID, p_kind TEXT, p_stock INTEGER) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT CASE p_kind WHEN 'COMBO' THEN combo_available(p_id)
                     WHEN 'DAILY_SPECIAL' THEN daily_available(p_id)
                     ELSE p_stock END
$$;
