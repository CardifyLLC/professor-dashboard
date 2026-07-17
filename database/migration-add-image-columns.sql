-- Migration: Add front_image_urls and back_image_urls columns to existing orders table
-- Run this in your Supabase SQL Editor if you already have an existing orders table
-- This is safe to run multiple times (uses IF NOT EXISTS)

-- Add front_image_urls column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'orders' 
        AND column_name = 'front_image_urls'
    ) THEN
        ALTER TABLE orders 
        ADD COLUMN front_image_urls JSONB DEFAULT '[]'::jsonb;
        
        RAISE NOTICE 'Added front_image_urls column';
    ELSE
        RAISE NOTICE 'front_image_urls column already exists';
    END IF;
END $$;

-- Add back_image_urls column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'orders' 
        AND column_name = 'back_image_urls'
    ) THEN
        ALTER TABLE orders 
        ADD COLUMN back_image_urls JSONB DEFAULT '[]'::jsonb;
        
        RAISE NOTICE 'Added back_image_urls column';
    ELSE
        RAISE NOTICE 'back_image_urls column already exists';
    END IF;
END $$;

-- Optional: Update existing orders to populate front_image_urls and back_image_urls
-- This extracts front/back URLs from card_data if available
-- Uncomment and modify if you have existing orders with card_data structure

/*
DO $$
DECLARE
    order_record RECORD;
    front_urls JSONB;
    back_urls JSONB;
    card_item JSONB;
BEGIN
    FOR order_record IN 
        SELECT id, card_data, card_images 
        FROM orders 
        WHERE (front_image_urls IS NULL OR front_image_urls = '[]'::jsonb)
           OR (back_image_urls IS NULL OR back_image_urls = '[]'::jsonb)
    LOOP
        front_urls := '[]'::jsonb;
        back_urls := '[]'::jsonb;
        
        -- Extract front and back URLs from card_data
        IF order_record.card_data IS NOT NULL AND jsonb_array_length(order_record.card_data) > 0 THEN
            FOR card_item IN SELECT * FROM jsonb_array_elements(order_record.card_data)
            LOOP
                -- Add front URL if available
                IF card_item->>'frontUrl' IS NOT NULL THEN
                    front_urls := front_urls || jsonb_build_array(card_item->>'frontUrl');
                ELSIF card_item->>'front' IS NOT NULL AND (card_item->>'front')::text LIKE 'http%' THEN
                    front_urls := front_urls || jsonb_build_array(card_item->>'front');
                END IF;
                
                -- Add back URL if available
                IF card_item->>'backUrl' IS NOT NULL THEN
                    back_urls := back_urls || jsonb_build_array(card_item->>'backUrl');
                ELSIF card_item->>'back' IS NOT NULL AND (card_item->>'back')::text LIKE 'http%' THEN
                    back_urls := back_urls || jsonb_build_array(card_item->>'back');
                END IF;
            END LOOP;
        END IF;
        
        -- Update the order with extracted URLs
        UPDATE orders
        SET 
            front_image_urls = CASE 
                WHEN front_image_urls IS NULL OR front_image_urls = '[]'::jsonb 
                THEN front_urls 
                ELSE front_image_urls 
            END,
            back_image_urls = CASE 
                WHEN back_image_urls IS NULL OR back_image_urls = '[]'::jsonb 
                THEN back_urls 
                ELSE back_image_urls 
            END
        WHERE id = order_record.id;
    END LOOP;
    
    RAISE NOTICE 'Migration completed for existing orders';
END $$;
*/

-- Verify the migration
SELECT 
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('front_image_urls', 'back_image_urls')
ORDER BY column_name;

