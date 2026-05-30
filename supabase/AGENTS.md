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
- `migrate-v3.2-orders-quantity-compat.sql`: orders.quantity compatibility and order_items sync trigger.
- `migrate-v3.3-city-sort-order.sql`: admin city sort index support.
- `migrate-v3.4-admin-city-sort-and-safe-order-delete.sql`: atomic city reorder and safe order delete RPC.
- `migrate-v3.5-order-delete-permissions.sql`: align delete permissions with web/mobile single-order delete flow.
- `migrate-v3.6-sample-order-items.sql`: sample order item flag + distribution 5x rule exemption for sample lines.
- `migrate-v3.7-order-payment-note.sql`: order payment note + admin RPC for cashier manual rounding remark.
- `migrate-v3.8-city-sort-index-guard.sql`: city sort_index de-dup + append-at-bottom insert guard + swap safety.
- `migrate-v3.9-rls-optimization.sql`: RLS helper functions + policy optimization/hardening.
- `migrate-v3.10-profiles-self-heal.sql`: allow users to self-heal missing distributor profile rows.
- `migrate-v4.0-store-management.sql`: stores/store inventory/store pricing schema + data bootstrap + store-aware order RPCs.
- `migrate-v4.1-store-optional-distributor.sql`: make stores.distributor_id nullable for deferred distributor binding.
- `migrate-v4.2-store-inventory-distributor-write.sql`: allow distributors to insert/update own store_inventory rows.
- `migrate-v4.3-store-super-admin-and-retail-store.sql`: add super_admin role + store contact + retail store binding support.
- `migrate-v4.4-retail-default-yunchuang-store.sql`: default retail order store to 云窗 + backfill historical retail store_id.
- `migrate-v4.5-retail-delete-rollback-and-unpaid-cleanup.sql`: retail delete rollback fix (total inventory only) + schema gate update.
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
11. `migrate-v3.2-orders-quantity-compat.sql`
12. `migrate-v3.3-city-sort-order.sql`
13. `migrate-v3.4-admin-city-sort-and-safe-order-delete.sql`
14. `migrate-v3.5-order-delete-permissions.sql`
15. `migrate-v3.6-sample-order-items.sql`
16. `migrate-v3.7-order-payment-note.sql`
17. `migrate-v3.8-city-sort-index-guard.sql`
18. `migrate-v3.9-rls-optimization.sql`
19. `migrate-v3.10-profiles-self-heal.sql`
20. `migrate-v4.0-store-management.sql`
21. `migrate-v4.1-store-optional-distributor.sql`
22. `migrate-v4.2-store-inventory-distributor-write.sql`
23. `migrate-v4.3-store-super-admin-and-retail-store.sql`
24. `migrate-v4.4-retail-default-yunchuang-store.sql`
25. `migrate-v4.5-retail-delete-rollback-and-unpaid-cleanup.sql`
26. `storage-policies.sql`

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
11. `migrate-v3.2-orders-quantity-compat.sql`
12. `migrate-v3.3-city-sort-order.sql`
13. `migrate-v3.4-admin-city-sort-and-safe-order-delete.sql`
14. `migrate-v3.5-order-delete-permissions.sql`
15. `migrate-v3.6-sample-order-items.sql`
16. `migrate-v3.7-order-payment-note.sql`
17. `migrate-v3.8-city-sort-index-guard.sql`
18. `migrate-v3.9-rls-optimization.sql`
19. `migrate-v3.10-profiles-self-heal.sql`
20. `migrate-v4.0-store-management.sql`
21. `migrate-v4.1-store-optional-distributor.sql`
22. `migrate-v4.2-store-inventory-distributor-write.sql`
23. `migrate-v4.3-store-super-admin-and-retail-store.sql`
24. `migrate-v4.4-retail-default-yunchuang-store.sql`
25. `migrate-v4.5-retail-delete-rollback-and-unpaid-cleanup.sql`
26. `storage-policies.sql`

## TABLES

- `profiles`: Extends auth.users (role, city_id, store_name).
- `cities`: City names for filtering.
- `products`: Name, price, cost, one_time_cost, discount_price, city_id.
- `inventory`: product_id, quantity, min_quantity.
- `orders`: distributor_id, city_id, status, totals.
- `order_items`: order_id, product_id, quantity, prices, unit_cost.
- `distributor_product_prices`: Custom discount per distributor.
- `stores`: store master data (city/distributor binding, discount rate, status).
- `store_inventory`: per-store inventory pool by product.
- `store_product_prices`: per-store product override price.
- `app_schema_meta`: schema version gate metadata.
- `notifications`: user_id, type, order_id, message.

## GOTCHAS

- `min(uuid)`: Use `ARRAY_AGG(...)[1]::uuid` instead.
- `Storage RLS`: Upload path must be `{auth.uid()}/products/...`.
- `RLS`: Ensure `profiles` table has correct role for admin access.
