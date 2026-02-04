-- Add set_type and total_cost to ichiban_kuji table
ALTER TABLE ichiban_kuji ADD COLUMN IF NOT EXISTS set_type TEXT DEFAULT 'custom';
ALTER TABLE ichiban_kuji ADD COLUMN IF NOT EXISTS total_cost NUMERIC DEFAULT 0;

-- Make product_id nullable in ichiban_kuji_prizes (for official sets where prizes don't link to products)
ALTER TABLE ichiban_kuji_prizes ALTER COLUMN product_id DROP NOT NULL;

-- Add prize_name for official set prizes (free-text product name not linked to products table)
ALTER TABLE ichiban_kuji_prizes ADD COLUMN IF NOT EXISTS prize_name TEXT;

-- Add opening_combo_prices for first-draw-only discounts (applies only when the set is completely untouched)
ALTER TABLE ichiban_kuji ADD COLUMN IF NOT EXISTS opening_combo_prices JSONB DEFAULT '[]'::jsonb;

-- Make product_id nullable in sale_items and delivery_items (for official set prizes without linked products)
ALTER TABLE sale_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE delivery_items ALTER COLUMN product_id DROP NOT NULL;
