-- Migration: 修復進貨單小數點問題
-- 問題：subtotal 是 generated column，用 quantity * cost 自動計算會產生小數
-- 解決：將 subtotal 改為普通欄位，手動設定整數值
-- 執行方式：在 Supabase SQL Editor 中執行此腳本

-- ============================================================
-- 步驟 0：將 subtotal 從 generated column 改為普通欄位
-- ============================================================

-- 先備份現有資料
CREATE TABLE IF NOT EXISTS public.purchase_items_backup AS 
SELECT * FROM public.purchase_items;

-- 移除 generated column 並重新建立為普通欄位
ALTER TABLE public.purchase_items DROP COLUMN IF EXISTS subtotal;
ALTER TABLE public.purchase_items ADD COLUMN subtotal NUMERIC(12,2);

-- 用 ROUND 計算填入資料
UPDATE public.purchase_items
SET subtotal = ROUND(quantity * cost);

-- ============================================================
-- 步驟 1：修復 purchases 的 total
-- ============================================================

-- 使用 purchase_items 的 subtotal 總和來更新 purchases.total
UPDATE public.purchases p
SET total = (
  SELECT COALESCE(SUM(ROUND(pi.subtotal)), 0)
  FROM public.purchase_items pi
  WHERE pi.purchase_id = p.id
)
WHERE EXISTS (
  SELECT 1 FROM public.purchase_items pi WHERE pi.purchase_id = p.id
);

-- ============================================================
-- 步驟 3：修復 partner_accounts (AP) 的 amount
-- ============================================================

-- 更新 AP 記錄的 amount 為整數
-- 注意：balance 是 generated column (amount - received_paid)，不能直接更新
UPDATE public.partner_accounts pa
SET amount = ROUND(amount)
WHERE direction = 'AP'
  AND amount != ROUND(amount);

-- ============================================================
-- 步驟 4：修復進貨單的付款狀態
-- ============================================================

-- 找出所有 AP 都已付清但 is_paid=false 的進貨單，更新為 is_paid=true
UPDATE public.purchases p
SET is_paid = true
WHERE is_paid = false
  AND NOT EXISTS (
    SELECT 1 FROM public.partner_accounts pa
    WHERE pa.ref_type = 'purchase'
      AND pa.ref_id = p.id
      AND pa.status != 'paid'
  )
  AND EXISTS (
    SELECT 1 FROM public.partner_accounts pa
    WHERE pa.ref_type = 'purchase'
      AND pa.ref_id = p.id
  );

-- ============================================================
-- 驗證結果
-- ============================================================

-- 檢查是否還有小數點的進貨單
SELECT id, purchase_no, total 
FROM public.purchases 
WHERE total != ROUND(total)
LIMIT 10;

-- 檢查是否還有小數點的進貨明細
SELECT id, quantity, cost, subtotal, ROUND(quantity * cost) as expected
FROM public.purchase_items 
WHERE subtotal != ROUND(subtotal) OR subtotal IS NULL
LIMIT 10;
