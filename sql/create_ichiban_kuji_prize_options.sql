-- 一番賞複選獎選項表
-- 每列 = 一個可選商品選項。例：A賞有 5 個商品選項 → 5 列
-- prize.quantity 控制可抽幾次，選項池是候選，quantity <= 選項數
CREATE TABLE ichiban_kuji_prize_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prize_id UUID NOT NULL REFERENCES ichiban_kuji_prizes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  is_consumed BOOLEAN NOT NULL DEFAULT false,
  consumed_sale_item_id UUID REFERENCES sale_items(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prize_options_prize_id ON ichiban_kuji_prize_options(prize_id);
