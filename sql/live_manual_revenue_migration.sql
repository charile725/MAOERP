-- 直播收銀改為不計算營收：營業額於日結時手動輸入
-- 在 Supabase SQL Editor 執行

ALTER TABLE business_day_closings
  ADD COLUMN IF NOT EXISTS manual_revenue numeric(12,2);

COMMENT ON COLUMN business_day_closings.manual_revenue IS
  '直播（source=live）日結時手動輸入的營業額。店裡收銀（source=pos）為 NULL，營收仍由 sales 加總。';
