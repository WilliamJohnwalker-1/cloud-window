# AGENTS.md

**Generated:** 2026-03-06
**Stack:** Expo 55 + React Native 0.83 + Supabase + Zustand

## OVERVIEW

供销管理系统 v2 — 多角色供应链管理（管理员/分销商/库存管理员）。支持城市维度商品、订单流程、通知接单、报表导出。

## STRUCTURE

```
.
├── App.tsx              # Entry point, tab navigation, Toast provider
├── src/
│   ├── screens/         # 6 screen components (300-1000 lines each)
│   ├── store/           # Zustand state (useAppStore.ts)
│   ├── types/           # TypeScript interfaces
│   ├── lib/             # Supabase client
│   ├── theme.ts         # Pink-blue design system
│   └── utils/           # Barcode utilities
└── supabase/            # SQL schema + migrations
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add/modify screen | `src/screens/*.tsx` | Each screen is self-contained |
| Business logic | `src/store/useAppStore.ts` | 857 lines, all CRUD operations |
| Types/interfaces | `src/types/index.ts` | Order, Product, Profile, etc. |
| Theme/colors | `src/theme.ts` | Colors, Radius, Shadow, Gradients |
| DB schema | `supabase/schema.sql` | Full schema with RLS policies |
| Migrations | `supabase/migrate-*.sql` | Run in order |

## CODE MAP

- `useAppStore` (src/store/useAppStore.ts): Zustand store with all CRUD, auth, and state.
- `Profile`, `Product`, `Order`, `OrderItem` (src/types/index.ts): Core data models.
- `Colors`, `Radius`, `Shadow`, `Gradients` (src/theme.ts): Design tokens for pink-blue theme.
- `ProductsScreen`: Product CRUD, image upload, distributor discount.
- `InventoryScreen`: Stock management, barcode inbound, low stock alerts.
- `OrdersScreen`: Order creation, cart, outbound, admin accept.
- `ReportsScreen`: Sales/inventory/profit reports, Excel/PDF export.
- `ProfileScreen`: User profile, city/distributor management, notifications.
- `LoginScreen`: Auth, registration with city/store.

## COMMANDS

- `npx expo start`: Start development server.
- `npx tsc --noEmit`: Run TypeScript type check.
- `npx expo lint`: Run linting (if configured).

## 当前状态（已完成）

1. UI 已完成粉蓝年轻化改造（登录页、个人页、主流程页面主题统一）。
2. 订单模型升级为 `orders + order_items`，支持一单多商品。
3. 商品新增 `one_time_cost`、`discount_price`，支持管理员按分销商设置差异折扣。
4. 分销商账号能力：
   - 仅查看所属城市商品；
   - 仅查看自己订单；
   - 可在个人信息中修改店面，不可修改城市。
5. 管理员能力：
   - 可只修改分销商城市，不强制修改店面；
   - 可在通知中接单，订单状态从 `pending` 到 `accepted`；
   - 分销商可收到“已接单”通知。
6. 报表已区分零售总价与折扣总价，并支持 Excel/PDF 导出。
7. 销售报表已移除“总收入(折扣)”展示项，仅保留零售总价与订单数量。
8. 利润口径已锁定：`order_items.unit_cost` 下单时快照；总成本按 `数量*unit_cost + 一次性成本` 计算。
9. 利润按商品ID聚合，一次性成本按商品只计一次，避免重复叠加。
10. 上传图片 RLS 问题已通过 `supabase/storage-policies.sql` 方案修复。

## 关键代码位置

- `src/store/useAppStore.ts`：核心业务流（登录态、商品/库存、下单、通知、接单）。
- `src/types/index.ts`：类型定义（订单状态、通知类型、订单项等）。
- `src/screens/`：
  - `LoginScreen.tsx`：品牌文案与注册字段（城市/店面）
  - `ProductsScreen.tsx`：折扣/一次性成本展示与编辑
  - `InventoryScreen.tsx`：库存管理与编辑入口
  - `OrdersScreen.tsx`：管理员筛选、接单按钮、分销商订单视图
  - `ReportsScreen.tsx`：收入口径与导出
  - `ProfileScreen.tsx`：个人信息、分销商管理、通知中心
- `supabase/`：
  - `schema.sql`（全量建库）
  - `migrate-v2.sql`（旧项目升级到 v2）
  - `migrate-v2.1-notifications.sql`（通知+接单状态）
  - `migrate-v2.2-unit-cost-snapshot.sql`（订单项 unit_cost 快照）
  - `storage-policies.sql`（图片上传 RLS）

## 数据库执行顺序

> 在 Supabase SQL Editor 中执行“SQL 内容”，不要执行文件路径字符串。

### 新项目（推荐）

1. `supabase/schema.sql`
2. `supabase/migrate-v2.1-notifications.sql`
3. `supabase/migrate-v2.2-unit-cost-snapshot.sql`
4. `supabase/storage-policies.sql`

### 旧项目升级

1. `supabase/migrate-v2.sql`
2. `supabase/migrate-v2.1-notifications.sql`
3. `supabase/migrate-v2.2-unit-cost-snapshot.sql`
4. `supabase/storage-policies.sql`

## 已知坑位

1. 若遇到 `min(uuid) does not exist`：
   - 使用 `migrate-v2.sql` 中已修复版本（`ARRAY_AGG(...)[1]::uuid`）
   - 不要回退到旧的 `MIN(p.city_id)` 写法。
2. 若遇到 `StorageApiError: new row violates row-level security policy`：
   - 确认执行 `storage-policies.sql`；
   - 上传路径需符合 `{auth.uid()}/products/...`。

## 验证基线

每次改动后至少执行：

1. `npx tsc --noEmit`
2. `npx expo start`（确认 Metro 正常启动）
3. 手测关键链路：
   - 分销商下单 -> 管理员收到新订单通知
   - 管理员接单 -> 分销商收到“已接单”通知

## 下一步建议

1. 做一次端到端回归（含多城市、多分销商场景）。
2. 增加通知与订单状态变更的自动化测试（至少 store 层）。
3. 视业务需求再接入推送通知（当前为站内通知）。
