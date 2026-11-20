-- 016 · Lucro do cupom. Idempotente.
-- O cupom guardava só unit_price (preço com desconto, o "por" do encarte). O supermercado paga ao VizinhoHub a diferença
-- entre o preço base (original_price, o "de") e o preço do encarte; sem o "de" no cupom não dá para calcular esse lucro.
-- Cupons antigos: usa o "de" da oferta e, se ela não tiver, o próprio unit_price (lucro zero).
ALTER TABLE deal_coupons ADD COLUMN IF NOT EXISTS original_price NUMERIC(10,2);

UPDATE deal_coupons k
   SET original_price = coalesce(d.original_price, k.unit_price)
  FROM deals d
 WHERE d.id = k.deal_id AND k.original_price IS NULL;

ALTER TABLE deal_coupons ALTER COLUMN original_price SET NOT NULL;

ALTER TABLE deal_coupons DROP CONSTRAINT IF EXISTS deal_coupons_original_price_check;
ALTER TABLE deal_coupons ADD CONSTRAINT deal_coupons_original_price_check CHECK (original_price >= unit_price);
