-- 新增 points_redeemed 欄位到 sales 表
-- 用於記錄本筆銷售使用了多少積分作為現金折抵（1點=1元）
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS points_redeemed INTEGER NOT NULL DEFAULT 0;
