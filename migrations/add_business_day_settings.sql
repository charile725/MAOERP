-- 新增營業日設定表
-- 用於追蹤當前營業日，解決跨日營業的問題

CREATE TABLE IF NOT EXISTS business_day_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,  -- 'pos' | 'live'
  current_business_date DATE NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source)
);

-- 初始化資料（使用最後日結日期+1天，或今天日期）
INSERT INTO business_day_settings (source, current_business_date)
SELECT 'pos', COALESCE(
  (SELECT business_date + INTERVAL '1 day' FROM business_day_closings WHERE source = 'pos' ORDER BY business_date DESC LIMIT 1)::DATE,
  CURRENT_DATE
)
WHERE NOT EXISTS (SELECT 1 FROM business_day_settings WHERE source = 'pos');

INSERT INTO business_day_settings (source, current_business_date)
SELECT 'live', COALESCE(
  (SELECT business_date + INTERVAL '1 day' FROM business_day_closings WHERE source = 'live' ORDER BY business_date DESC LIMIT 1)::DATE,
  CURRENT_DATE
)
WHERE NOT EXISTS (SELECT 1 FROM business_day_settings WHERE source = 'live');

-- 添加註解
COMMENT ON TABLE business_day_settings IS '營業日設定，用於追蹤當前營業日';
COMMENT ON COLUMN business_day_settings.source IS '銷售通路: pos 或 live';
COMMENT ON COLUMN business_day_settings.current_business_date IS '當前營業日，日結後自動推進到下一天';
