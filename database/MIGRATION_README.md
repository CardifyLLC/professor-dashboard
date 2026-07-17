# Database Migration Guide

## Migration Files

### `migration-add-user-designs-wallets.sql`

**Purpose:** Adds auth-owned user profiles, saved designs, wallet tables for future `prints` credits, print pricing rules, and `user_id` / `design_id` links on orders.

**When to use:**
- You already have an `orders` table
- You want to persist saved designs per logged-in user
- You want a future-ready wallet / ledger model for prints
- You want orders linked back to both the authenticated user and the source design

**What it does:**
1. Creates `profiles`
2. Creates `designs`
3. Creates `wallet_accounts`
4. Creates `wallet_ledger_entries`
5. Creates `print_pricing_rules`
6. Backfills profiles from `auth.users`
7. Adds missing order-link columns like `user_id`, `design_id`, `required_prints`, `payment_source`, and `pricing_snapshot`
8. Enables RLS policies for user-owned reads and writes on the new auth-owned tables

**How to run:**
1. Open Supabase Dashboard -> SQL Editor
2. Copy and paste the contents of `migration-add-user-designs-wallets.sql`
3. Click `Run`
4. Confirm the new tables and order columns were created

**Safety:**
- Safe to run on an existing database
- Uses `IF NOT EXISTS` / idempotent patterns for tables, indexes, and functions
- Does not delete existing order data

### `migration-add-image-columns.sql`

**Purpose:** Adds `front_image_urls` and `back_image_urls` columns to existing `orders` table.

**When to use:**
- You already have an `orders` table
- You want to add support for separate front/back image tracking
- You're upgrading from an older version

**What it does:**
1. Adds `front_image_urls` JSONB column (defaults to empty array)
2. Adds `back_image_urls` JSONB column (defaults to empty array)
3. Verifies the columns were added successfully

**How to run:**
1. Open Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `migration-add-image-columns.sql`
3. Click "Run" or press `Ctrl+Enter`
4. Check the output for success messages

**Safety:**
- ✅ Safe to run multiple times (uses `IF NOT EXISTS` checks)
- ✅ Won't delete or modify existing data
- ✅ Won't break if columns already exist

**After migration:**
- New orders will automatically populate `front_image_urls` and `back_image_urls`
- Existing orders will have empty arrays `[]` for these fields
- You can optionally uncomment the migration script section to extract URLs from existing `card_data`

## Full Schema vs Migration

### Use `schema.sql` if:
- Setting up a **new database** from scratch
- You don't have an `orders` table yet
- You want the complete schema with all columns

### Use `migration-add-image-columns.sql` if:
- You **already have** an `orders` table
- You want to **add** the new columns without recreating the table
- You want to preserve existing data

## Verifying Migration

After running the migration, verify it worked:

```sql
-- Check if columns exist
SELECT 
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('front_image_urls', 'back_image_urls')
ORDER BY column_name;
```

You should see:
```
column_name        | data_type | column_default
-------------------+-----------+----------------
back_image_urls    | jsonb     | '[]'::jsonb
front_image_urls   | jsonb     | '[]'::jsonb
```

## Troubleshooting

### Error: "column already exists"
- This is fine! The migration checks for existing columns
- Your database already has the columns

### Error: "relation 'orders' does not exist"
- You need to run `schema.sql` first to create the table
- Then you can run the migration if needed

### Want to populate existing orders?
- Uncomment the optional migration section in the SQL file
- Modify it based on your `card_data` structure
- Run it to extract URLs from existing orders

