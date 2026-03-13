# Supabase AGENTS.md

## OVERVIEW

PostgreSQL schema with RLS policies for multi-role inventory management.

## STRUCTURE

- `schema.sql`: Full schema, all tables, RLS policies.
- `migrate-v2.sql`: Upgrade from v1 to v2.
- `migrate-v2.1-notifications.sql`: Notifications + order status.
- `migrate-v2.2-unit-cost-snapshot.sql`: Order item cost snapshot.
- `migrate-v2.3-barcode.sql`: Barcode field.
- `migrate-v2.4-atomic-order-workflows.sql`: Transactional RPC for order/outbound workflows.
- `migrate-v2.5-inventory-logs.sql`: Inventory movement logging table + RLS.
- `migrate-v2.8-payment-events.sql`: Payment fields on orders + payment event ledger.
- `migrate-v2.9-order-kinds-retail.sql`: Order kind split + retail cashier atomic order RPC.
- `migrate-v3.0-request-id-compat.sql`: request_id compatibility hotfix for atomic order RPC.
- `migrate-v3.1-schema-version-gate.sql`: schema version gate RPC for web startup checks.
- `storage-policies.sql`: Image upload RLS.

## EXECUTION ORDER

### New Project
1. `schema.sql`
2. `migrate-v2.1-notifications.sql`
3. `migrate-v2.2-unit-cost-snapshot.sql`
4. `migrate-v2.3-barcode.sql`
5. `migrate-v2.4-atomic-order-workflows.sql`
6. `migrate-v2.5-inventory-logs.sql`
7. `migrate-v2.8-payment-events.sql`
8. `migrate-v2.9-order-kinds-retail.sql`
9. `migrate-v3.0-request-id-compat.sql`
10. `migrate-v3.1-schema-version-gate.sql`
11. `storage-policies.sql`

### Upgrade
1. `migrate-v2.sql`
2. `migrate-v2.1-notifications.sql`
3. `migrate-v2.2-unit-cost-snapshot.sql`
4. `migrate-v2.3-barcode.sql`
5. `migrate-v2.4-atomic-order-workflows.sql`
6. `migrate-v2.5-inventory-logs.sql`
7. `migrate-v2.8-payment-events.sql`
8. `migrate-v2.9-order-kinds-retail.sql`
9. `migrate-v3.0-request-id-compat.sql`
10. `migrate-v3.1-schema-version-gate.sql`
11. `storage-policies.sql`

## TABLES

- `profiles`: Extends auth.users (role, city_id, store_name).
- `cities`: City names for filtering.
- `products`: Name, price, cost, one_time_cost, discount_price, city_id.
- `inventory`: product_id, quantity, min_quantity.
- `orders`: distributor_id, city_id, status, totals.
- `order_items`: order_id, product_id, quantity, prices, unit_cost.
- `distributor_product_prices`: Custom discount per distributor.
- `notifications`: user_id, type, order_id, message.

## GOTCHAS

- `min(uuid)`: Use `ARRAY_AGG(...)[1]::uuid` instead.
- `Storage RLS`: Upload path must be `{auth.uid()}/products/...`.
- `RLS`: Ensure `profiles` table has correct role for admin access.
