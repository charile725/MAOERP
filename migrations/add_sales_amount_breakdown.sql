-- 新增銷售金額明細欄位，支援多種數據口徑
-- Gross Sales (交易額) vs Net Collected (實收)

-- 新增欄位
ALTER TABLE sales
ADD COLUMN IF NOT EXISTS subtotal numeric(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount numeric(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS store_credit_used numeric(10, 2) DEFAULT 0;

COMMENT ON COLUMN sales.subtotal IS '原始銷售額 (Gross Sales) = Σ(price × qty)';
COMMENT ON COLUMN sales.discount_amount IS '折扣金額';
COMMENT ON COLUMN sales.store_credit_used IS '使用的購物金';
COMMENT ON COLUMN sales.total IS '實收金額 (Net Collected) = subtotal - discount_amount - store_credit_used';

-- 更新現有資料：從 sale_items 計算 subtotal
UPDATE sales s
SET subtotal = COALESCE((
  SELECT SUM(si.price * si.quantity)
  FROM sale_items si
  WHERE si.sale_id = s.id
), 0)
WHERE subtotal = 0 OR subtotal IS NULL;

-- 更新現有資料：計算 discount_amount
UPDATE sales
SET discount_amount = CASE
  WHEN discount_type = 'percent' THEN ROUND(subtotal * discount_value / 100, 2)
  WHEN discount_type = 'amount' THEN discount_value
  ELSE 0
END
WHERE discount_amount = 0 OR discount_amount IS NULL;

-- 更新現有資料：反推 store_credit_used
-- store_credit_used = subtotal - discount_amount - total
UPDATE sales
SET store_credit_used = GREATEST(0, subtotal - discount_amount - total)
WHERE store_credit_used = 0 OR store_credit_used IS NULL;
