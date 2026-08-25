-- ============================================
-- 找出重複進貨的庫存日誌
-- ============================================

-- 方法 1：找出同一個進貨單有多筆庫存日誌的情況
-- 如果同一個 product_id + ref_id (purchase_id) 有超過 1 筆記錄，可能是重複
SELECT
    il.ref_id as purchase_id,
    il.product_id,
    p.name as product_name,
    p.item_code,
    COUNT(*) as log_count,
    SUM(il.qty_change) as total_qty_added,
    STRING_AGG(il.memo, ' | ') as memos,
    STRING_AGG(il.id::text, ', ') as log_ids
FROM inventory_logs il
LEFT JOIN products p ON p.id = il.product_id
WHERE il.ref_type = 'purchase'
GROUP BY il.ref_id, il.product_id, p.name, p.item_code
HAVING COUNT(*) > 1
ORDER BY il.ref_id;

-- ============================================

-- 方法 2：找出同時有「批准」和「收貨」記錄的進貨單
SELECT
    il.ref_id as purchase_id,
    pu.purchase_no,
    il.product_id,
    p.name as product_name,
    il.qty_change,
    il.memo,
    il.created_at,
    il.id as log_id
FROM inventory_logs il
LEFT JOIN products p ON p.id = il.product_id
LEFT JOIN purchases pu ON pu.id = il.ref_id::uuid
WHERE il.ref_type = 'purchase'
  AND il.ref_id IN (
    -- 找出同時有批准和收貨記錄的進貨單
    SELECT ref_id
    FROM inventory_logs
    WHERE ref_type = 'purchase'
      AND memo LIKE '%批准%'
    INTERSECT
    SELECT ref_id
    FROM inventory_logs
    WHERE ref_type = 'purchase'
      AND memo LIKE '%收貨%'
  )
ORDER BY il.ref_id, il.product_id, il.created_at;

-- ============================================

-- 方法 3：列出所有需要刪除的「批准入庫」記錄
-- 這些是重複的，應該刪除
SELECT
    il.id as log_id_to_delete,
    il.ref_id as purchase_id,
    pu.purchase_no,
    il.product_id,
    p.name as product_name,
    p.item_code,
    il.qty_change as duplicate_qty,
    il.memo,
    il.created_at
FROM inventory_logs il
LEFT JOIN products p ON p.id = il.product_id
LEFT JOIN purchases pu ON pu.id = il.ref_id::uuid
WHERE il.ref_type = 'purchase'
  AND il.memo LIKE '%進貨批准入庫%'
  -- 只選擇同時也有收貨記錄的（代表重複了）
  AND EXISTS (
    SELECT 1 FROM inventory_logs il2
    WHERE il2.ref_type = 'purchase'
      AND il2.ref_id = il.ref_id
      AND il2.product_id = il.product_id
      AND il2.memo LIKE '%收貨%'
  )
ORDER BY il.ref_id, il.product_id;

-- ============================================
-- 修復步驟（請先確認上面的查詢結果再執行）
-- ============================================

-- 步驟 1：備份要刪除的記錄（建議先執行這個）
-- CREATE TABLE inventory_logs_backup_duplicate AS
-- SELECT * FROM inventory_logs
-- WHERE id IN (
--     SELECT il.id
--     FROM inventory_logs il
--     WHERE il.ref_type = 'purchase'
--       AND il.memo LIKE '%進貨批准入庫%'
--       AND EXISTS (
--         SELECT 1 FROM inventory_logs il2
--         WHERE il2.ref_type = 'purchase'
--           AND il2.ref_id = il.ref_id
--           AND il2.product_id = il.product_id
--           AND il2.memo LIKE '%收貨%'
--       )
-- );

-- 步驟 2：刪除重複的批准入庫記錄
-- DELETE FROM inventory_logs
-- WHERE id IN (
--     SELECT il.id
--     FROM inventory_logs il
--     WHERE il.ref_type = 'purchase'
--       AND il.memo LIKE '%進貨批准入庫%'
--       AND EXISTS (
--         SELECT 1 FROM inventory_logs il2
--         WHERE il2.ref_type = 'purchase'
--           AND il2.ref_id = il.ref_id
--           AND il2.product_id = il.product_id
--           AND il2.memo LIKE '%收貨%'
--       )
-- );

-- 步驟 3：重新計算受影響商品的庫存
-- （如果你的系統有 trigger 自動計算庫存，可能需要手動修正）
-- UPDATE products p
-- SET stock = (
--     SELECT COALESCE(SUM(qty_change), 0)
--     FROM inventory_logs il
--     WHERE il.product_id = p.id
-- )
-- WHERE p.id IN (
--     SELECT DISTINCT product_id
--     FROM inventory_logs_backup_duplicate
-- );
