-- 官方套一番賞追蹤廠商與收貨狀態
ALTER TABLE ichiban_kuji ADD COLUMN vendor_code TEXT;
ALTER TABLE ichiban_kuji ADD COLUMN is_received BOOLEAN DEFAULT true;
-- 預設 true，讓既有資料不受影響；新建官方套時設 false
