-- 新增購物金轉換追蹤欄位
ALTER TABLE sale_items
ADD COLUMN IF NOT EXISTS store_credit_qty integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS store_credit_amount numeric(10, 2) DEFAULT 0;

COMMENT ON COLUMN sale_items.store_credit_qty IS '已轉購物金的數量';
COMMENT ON COLUMN sale_items.store_credit_amount IS '已轉購物金的金額';
