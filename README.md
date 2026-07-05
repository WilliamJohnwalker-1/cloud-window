# 云窗文创 · 供销管理系统

基于 **Expo + React Native + TypeScript + Supabase** 的供销管理系统（移动端 + Web 端）。

> 品牌文案已更新为：**云窗文创 / 供销管理系统**。

## 功能总览（v2）

### 1) 角色与权限

- `admin`：全权限（商品、库存、订单、通知接单、分销商管理、报表）
- `inventory_manager`：商品与库存管理
- `distributor`：仅查看所属城市商品，仅查看自己订单，可下单
- `finance`：可查看订单/建结算单/财务流水与报表（无接单、删单、改单、确认到货权限）

### 2) 商品与价格模型

- 商品新增字段：
  - `one_time_cost`（一次性成本，元）
  - `discount_price`（默认折扣价，元）
- 管理员可按“分销商 + 商品”配置差异折扣价（`distributor_product_prices`）
- 分销商端隐藏成本与库存相关敏感信息

### 3) 订单模型升级

- 由单行订单升级为：`orders`（订单头） + `order_items`（订单行）
- 一次下单只生成一条订单记录，多个商品合并在同一订单下
- 订单支持状态：`pending` / `accepted`

### 4) 通知与接单流程

- 分销商下单后，管理员会收到 `new_order` 通知
- 管理员在通知中心接单后：
  - 对应订单状态更新为 `accepted`
  - 分销商收到 `order_accepted` 通知

### 5) 城市与店面规则

- 分销商注册时设置所属城市与店面
- 分销商个人信息中：可改店面，不可改城市
- 管理员可修改分销商城市，且可只改城市不改店面

### 6) 报表与导出

- 销售报表概览显示：零售总价、订单数量（不再显示"总收入(折扣)"）
- 利润口径：
  - 总成本 = `销售数量 * unit_cost + 一次性成本`
  - `unit_cost` 固化在 `order_items`（下单时快照），避免后续商品成本修改影响历史利润
  - 一次性成本按商品聚合维度仅计一次，避免重复叠加
- 利润报表支持导出：Excel / PDF

### 7) 条码与入库/出库

- **条码生成**：商品添加时自动生成 EAN-13 条码
  - 格式：`2000000`（前缀）+ `XXXXX`（5位序号）+ 校验位
  - 支持扫码枪快速输入（13位数字自动识别）
- **入库功能**（库存管理页面）：
  - 输入/扫描13位条码 → 自动识别商品 → 输入数量 → 确认入库
  - 仅管理员/库存管理员可用
- **出库功能**（订单页面）：
  - 输入/扫描13位条码 → 自动识别商品 → 输入数量 → 确认出库
  - 出库时自动创建订单并扣减库存
  - 出库订单按**零售价**计算（视为零售订单）
  - 仅管理员/库存管理员可用
- **历史商品条码补齐**：管理员可在商品页一键为“无条码商品”批量生成条码
- **Web 收款台（扫码盒）**：管理员/库存管理员可在 Web 端执行“扫商品条码建单 -> 扫客户付款码收款”

## 技术栈

- 前端：Expo ~55、React Native 0.83、TypeScript
- Web 前端：Vite + React + TypeScript + Tailwind + Zustand
- 状态管理：Zustand + AsyncStorage
- 后端：Supabase（PostgreSQL / Auth / Storage）
- 导出：移动端 `xlsx` + `expo-print` + `expo-sharing` + `expo-file-system`；Web 单笔导出 `exceljs`
- OTA 更新：`expo-updates` + EAS Update
- UI组件：Lucide React Native（矢量图标）、react-native-gifted-charts（图表）、react-native-toast-message（提示）
- 设计系统：粉蓝年轻化主题（src/theme.ts）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 环境变量

复制 `.env.example` 为 `.env`，填写：

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. 初始化/升级数据库（Supabase SQL Editor）

> 注意：在 SQL Editor 中执行的是 **SQL 内容**，不是文件路径文本。

#### 新项目（全新库）

1. 执行 `supabase/schema.sql`
2. 执行 `supabase/migrate-v2.1-notifications.sql`
3. 执行 `supabase/migrate-v2.2-unit-cost-snapshot.sql`
4. 执行 `supabase/migrate-v2.3-barcode.sql`
5. 执行 `supabase/migrate-v2.4-atomic-order-workflows.sql`
6. 执行 `supabase/migrate-v2.5-inventory-logs.sql`
7. 执行 `supabase/migrate-v2.8-payment-events.sql`
8. 执行 `supabase/migrate-v2.9-order-kinds-retail.sql`
9. 执行 `supabase/migrate-v3.0-request-id-compat.sql`
10. 执行 `supabase/migrate-v3.1-schema-version-gate.sql`
11. 执行 `supabase/migrate-v3.2-orders-quantity-compat.sql`
12. 执行 `supabase/migrate-v3.3-city-sort-order.sql`
13. 执行 `supabase/migrate-v3.4-admin-city-sort-and-safe-order-delete.sql`
14. 执行 `supabase/migrate-v3.5-order-delete-permissions.sql`
15. 执行 `supabase/migrate-v3.6-sample-order-items.sql`
16. 执行 `supabase/migrate-v3.7-order-payment-note.sql`
17. 执行 `supabase/migrate-v3.8-city-sort-index-guard.sql`
18. 执行 `supabase/migrate-v3.9-rls-optimization.sql`
19. 执行 `supabase/migrate-v3.10-profiles-self-heal.sql`
20. 执行 `supabase/migrate-v4.0-store-management.sql`
21. 执行 `supabase/migrate-v4.1-store-optional-distributor.sql`
22. 执行 `supabase/migrate-v4.2-store-inventory-distributor-write.sql`
23. 执行 `supabase/migrate-v4.3-store-super-admin-and-retail-store.sql`
24. 执行 `supabase/migrate-v4.4-retail-default-yunchuang-store.sql`
25. 执行 `supabase/migrate-v4.5-retail-delete-rollback-and-unpaid-cleanup.sql`
26. 执行 `supabase/migrate-v4.6-store-retail-order.sql`
27. 执行 `supabase/migrate-v4.7-batch-order-fix-and-cost-sync.sql`
28. 执行 `supabase/migrate-v4.8-retail-item-level-rounding-and-refund.sql`
29. 执行 `supabase/migrate-v4.9-refund-approval.sql`
30. 执行 `supabase/migrate-v4.10-retail-rounding-orders-updated-at-fix.sql`
31. 执行 `supabase/migrate-v4.11-refund-delete-no-double-restore.sql`
32. 执行 `supabase/migrate-v5.0-settlement-order.sql`
33. 执行 `supabase/migrate-v5.1-default-store-selection.sql`
34. 执行 `supabase/migrate-v5.2-province.sql`
35. 执行 `supabase/migrate-v5.3-product-store-fields.sql`
36. 执行 `supabase/migrate-v5.4-quantity-rules.sql`
37. 执行 `supabase/migrate-v5.5-purchase-order.sql`
38. 执行 `supabase/migrate-v5.6-province-sort-order.sql`
39. 执行 `supabase/migrate-v5.7-inventory-alert-notifications.sql`
40. 执行 `supabase/storage-policies.sql`
41. 执行 `supabase/migrate-v6.0-foundation.sql`
42. 执行 `supabase/migrate-v6.1-finance.sql`
43. 执行 `supabase/migrate-v6.2-knowledge-base.sql`
44. 执行 `supabase/migrate-v6.3-finance-integration.sql`
45. 执行 `supabase/migrate-v6.4-financial-backfill.sql`
46. 执行 `supabase/migrate-v6.5-inventory-slow-moving-alert.sql`
47. 执行 `supabase/migrate-v6.6-inventory-log-completion.sql`
48. 执行 `supabase/migrate-v6.7-refund-reversal-backfill.sql`
49. 执行 `supabase/migrate-v6.8-retail-income-category-normalization.sql`
50. 执行 `supabase/migrate-v7.0-store-invoice-fields.sql`
51. 执行 `supabase/migrate-v7.1-finance-city-binding.sql`
52. 执行 `supabase/migrate-v7.2-purchase-order-separation.sql`

#### 旧项目升级（v1 -> v2）

1. 执行 `supabase/migrate-v2.sql`
2. 执行 `supabase/migrate-v2.1-notifications.sql`
3. 执行 `supabase/migrate-v2.2-unit-cost-snapshot.sql`
4. 执行 `supabase/migrate-v2.3-barcode.sql`
5. 执行 `supabase/migrate-v2.4-atomic-order-workflows.sql`
6. 执行 `supabase/migrate-v2.5-inventory-logs.sql`
7. 执行 `supabase/migrate-v2.8-payment-events.sql`
8. 执行 `supabase/migrate-v2.9-order-kinds-retail.sql`
9. 执行 `supabase/migrate-v3.0-request-id-compat.sql`
10. 执行 `supabase/migrate-v3.1-schema-version-gate.sql`
11. 执行 `supabase/migrate-v3.2-orders-quantity-compat.sql`
12. 执行 `supabase/migrate-v3.3-city-sort-order.sql`
13. 执行 `supabase/migrate-v3.4-admin-city-sort-and-safe-order-delete.sql`
14. 执行 `supabase/migrate-v3.5-order-delete-permissions.sql`
15. 执行 `supabase/migrate-v3.6-sample-order-items.sql`
16. 执行 `supabase/migrate-v3.7-order-payment-note.sql`
17. 执行 `supabase/migrate-v3.8-city-sort-index-guard.sql`
18. 执行 `supabase/migrate-v3.9-rls-optimization.sql`
19. 执行 `supabase/migrate-v3.10-profiles-self-heal.sql`
20. 执行 `supabase/migrate-v4.0-store-management.sql`
21. 执行 `supabase/migrate-v4.1-store-optional-distributor.sql`
22. 执行 `supabase/migrate-v4.2-store-inventory-distributor-write.sql`
23. 执行 `supabase/migrate-v4.3-store-super-admin-and-retail-store.sql`
24. 执行 `supabase/migrate-v4.4-retail-default-yunchuang-store.sql`
25. 执行 `supabase/migrate-v4.5-retail-delete-rollback-and-unpaid-cleanup.sql`
26. 执行 `supabase/migrate-v4.6-store-retail-order.sql`
27. 执行 `supabase/migrate-v4.7-batch-order-fix-and-cost-sync.sql`
28. 执行 `supabase/migrate-v4.8-retail-item-level-rounding-and-refund.sql`
29. 执行 `supabase/migrate-v4.9-refund-approval.sql`
30. 执行 `supabase/migrate-v4.10-retail-rounding-orders-updated-at-fix.sql`
31. 执行 `supabase/migrate-v4.11-refund-delete-no-double-restore.sql`
32. 执行 `supabase/migrate-v5.0-settlement-order.sql`
33. 执行 `supabase/migrate-v5.1-default-store-selection.sql`
34. 执行 `supabase/migrate-v5.2-province.sql`
35. 执行 `supabase/migrate-v5.3-product-store-fields.sql`
36. 执行 `supabase/migrate-v5.4-quantity-rules.sql`
37. 执行 `supabase/migrate-v5.5-purchase-order.sql`
38. 执行 `supabase/migrate-v5.6-province-sort-order.sql`
39. 执行 `supabase/migrate-v5.7-inventory-alert-notifications.sql`
40. 执行 `supabase/storage-policies.sql`
41. 执行 `supabase/migrate-v6.0-foundation.sql`
42. 执行 `supabase/migrate-v6.1-finance.sql`
43. 执行 `supabase/migrate-v6.2-knowledge-base.sql`
44. 执行 `supabase/migrate-v6.3-finance-integration.sql`
45. 执行 `supabase/migrate-v6.4-financial-backfill.sql`
46. 执行 `supabase/migrate-v6.5-inventory-slow-moving-alert.sql`
47. 执行 `supabase/migrate-v6.6-inventory-log-completion.sql`
48. 执行 `supabase/migrate-v6.7-refund-reversal-backfill.sql`
49. 执行 `supabase/migrate-v6.8-retail-income-category-normalization.sql`
50. 执行 `supabase/migrate-v7.0-store-invoice-fields.sql`
51. 执行 `supabase/migrate-v7.1-finance-city-binding.sql`
52. 执行 `supabase/migrate-v7.2-purchase-order-separation.sql`

#### 省份字段历史数据补齐（推荐）

升级完成后，建议额外执行一次：

1. 执行 `supabase/backfill-province.sql`

说明：该脚本只回填 `cities.province IS NULL` 的历史数据，幂等可重复执行。

### 4. 启动应用

```bash
npx expo start
```

### 5. 启动 Web 端（v1.3.6）

```bash
npm run web:v2
```

> Web 端目录：`web/`（与移动端代码完全分离）

#### Web 环境变量（Cloudflare/本地）

Web 登录依赖以下变量（推荐使用 `VITE_` 前缀）：

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_PAYMENT_API_URL=https://pay.yunchuang888888.com
VITE_PAYMENT_MOCK=false
```

> 兼容 `EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY`，但部署时建议统一使用 `VITE_*`。

支付链路发布前建议执行：

```bash
npm run payment:precheck --prefix web
```

### 6. 移动端 OTA 发布（应用内更新）

```bash
eas update --channel production --message "mobile ota: 描述本次改动"
```

> 说明：仅前端逻辑/UI改动可 OTA，下沉到原生层的改动仍需重新打包 APK。

### 7. Android 新包发布后自动同步（R2 + Worker变量）

```bash
# 1) 先执行 EAS 打包
eas build --platform android --profile production

# 2) 拿到 buildId 后执行同步
npm run release:android:sync -- --build-id <EAS_BUILD_ID>
```

该命令会自动：下载 APK、上传到 `cloud-window-apk-prod`、并回写 Worker 的
`MOBILE_LATEST_VERSION`、`MOBILE_ANDROID_APK_KEY`、`MOBILE_ANDROID_APK_URL`。

脚本回写策略已升级为 `wrangler secret bulk`（批量写入三项变量），并在回写后执行两步校验：
- 校验 Worker secret key 是否都存在；
- 校验 `/mobile/latest.json` 是否已返回最新版本、APK key、APK URL。

> 默认写入 **默认 Worker**（不附加 `--env`），避免误写到 `worker-name-production`。
> 可通过 `--worker-name <你的Worker名>` 指定回写目标（默认 `cloud-window`）。

双远端同步推送：

```bash
npm run push:both
```

### 8. Cloudflare Worker 自动部署（保留 Dashboard 变量）

在 Cloudflare Worker Build Configuration 中建议使用：

- Build command: `None`
- Deploy command: `npm run cf:deploy`
- Version command: `npm run cf:version`

其中 `cf:deploy` / `cf:version` 都使用 `wrangler deploy --keep-vars`，用于避免部署时清空你在 Dashboard 手动添加的 Text 变量。

> 注意：`wrangler versions upload` 当前不支持 `--keep-vars`。若把 Deploy command 设为 `npm run cf:version:upload`（或直接用 `wrangler versions upload`），会覆盖 Dashboard Text 变量（Secrets 通常仍保留）。

### 9. 自定义域名（解决 workers.dev 443 可达性 + APK 下载）

本项目采用子域拆分：

- 支付 API：`https://pay.yunchuang888888.com`
- APK 下载：`https://yunchuang888888.com/mobile/download/latest.apk`

- EAS 构建环境：`eas.json` 已设置 `EXPO_PUBLIC_PAYMENT_API_URL=https://pay.yunchuang888888.com`
- Web 环境请设置：`VITE_PAYMENT_API_URL=https://pay.yunchuang888888.com`
- Worker 路由建议：
  - `pay.yunchuang888888.com/api/*`
  - `pay.yunchuang888888.com/health`
  - `yunchuang888888.com/mobile/*`

连通性检查：

```bash
curl -I https://pay.yunchuang888888.com/health
curl https://pay.yunchuang888888.com/api/payment/config-check
curl https://yunchuang888888.com/mobile/latest.json
curl -I https://yunchuang888888.com/mobile/download/latest.apk
```

支付与下载相关 Worker 变量建议：

- `WECHAT_MCH_ID=<微信支付商户号>`
- `WECHAT_APP_ID=<微信支付关联 appid>`
- `WECHAT_SERIAL_NO=<商户证书序列号>`
- `WECHAT_PRIVATE_KEY=<商户 API 证书私钥 PEM>`
- `WECHAT_API_V3_KEY=<微信支付 APIv3 32位密钥>`
- `WECHAT_PLATFORM_PUBLIC_KEY=<微信支付平台公钥 PEM>`
- `WECHAT_NOTIFY_URL=https://pay.yunchuang888888.com/api/payment/wechat/notify`
- `WECHAT_GATEWAY=https://api.mch.weixin.qq.com`（可选）
- `ALIPAY_APP_ID=<支付宝应用ID>`
- `ALIPAY_PRIVATE_KEY=<支付宝应用私钥>`
- `ALIPAY_PUBLIC_KEY=<支付宝公钥>`
- `ALIPAY_NOTIFY_URL=https://pay.yunchuang888888.com/api/payment/alipay/notify`
- `MOBILE_ANDROID_APK_URL=https://yunchuang888888.com/mobile/download/latest.apk`

## 目录结构

```text
.
├── App.tsx              # 入口，Tab导航，Toast Provider
├── src/
│   ├── screens/         # 6个屏幕组件
│   │   ├── LoginScreen.tsx
│   │   ├── ProductsScreen.tsx
│   │   ├── InventoryScreen.tsx
│   │   ├── OrdersScreen.tsx
│   │   ├── ReportsScreen.tsx
│   │   └── ProfileScreen.tsx
│   ├── store/
│   │   └── useAppStore.ts
│   ├── types/
│   │   └── index.ts
│   ├── lib/
│   │   └── supabase.ts
│   ├── utils/
│   │   └── barcode.ts
│   └── theme.ts         # 粉蓝设计系统
├── supabase/
│   ├── schema.sql
│   ├── migrate-v2.sql
│   ├── migrate-v2.1-notifications.sql
│   ├── migrate-v2.2-unit-cost-snapshot.sql
│   ├── migrate-v2.3-barcode.sql
│   ├── migrate-v2.4-atomic-order-workflows.sql
│   └── storage-policies.sql
└── assets/
    └── ui/              # UI资源
```

## 常见问题

### 1) `syntax error at or near "supabase"`

原因：把 `supabase/xxx.sql` 文件路径直接粘贴到 SQL Editor 运行。  
正确做法：打开文件并粘贴其中 SQL 语句执行。

### 2) `function min(uuid) does not exist`

这是 PostgreSQL 对 `MIN(uuid)` 的兼容问题。  
本项目 `migrate-v2.sql` 已改为 `ARRAY_AGG(...)[1]::uuid` 方案，请使用当前版本脚本。

### 3) `StorageApiError: new row violates row-level security policy`

请执行 `supabase/storage-policies.sql`，并确认上传路径使用：

```text
{auth.uid()}/products/{filename}
```

## 验证建议

- `npm run typecheck`（移动端 + Web 分离校验，避免把 `dist` 构建产物纳入 root tsc）
- `npx expo start`
- 手工回归主链路：
  1. 分销商下单
  2. 管理员通知中心接单
  3. 分销商收到“已接单”通知

## 自动化安全约束（强制）

- 禁止创建测试账号（含子任务/子代理）：
  - 不允许在 Supabase Auth 注册临时账号
  - 不允许向 `profiles` / `auth.users` 写入测试用户
  - 账号联调仅使用人工提供的已有业务账号
- 禁止污染共享数据库：
  - 禁止运行“注册测试用户/提权测试用户/写入测试档案”脚本
  - 发现此类临时脚本必须先删除并汇报
- 双端推送策略：
  - 使用 `npm run push:both`
  - GitHub 失败仅允许单次尝试，不自动重试，立即通知人工接管

## 后续规划

- 计划区已收口（`web-cashier-xiaohongshu`、`v7-upgrade-batch` 已完成，当前无进行中自动续跑计划）

## 更新日志

### Web v1.3.6 (2026-07-05) - 搜索跳转落地 + 未支付超时清理修复

- 全局搜索结果支持点击后自动跳转到商品/库存/订单对应内容，并在目标项滚动定位后短暂高亮。
- 修复收银台未支付零售单超时清理回归：支付成功路径补回订单刷新触发，确保自动清理逻辑稳定生效。
- 未支付零售单超时规则由 30 分钟调整为 **10 分钟**（含收银台页面兜底检查）。

### Web v1.3.5 (2026-07-04) - 订单统计卡补齐 + 收银台耗时监控面板

- Web 订单页新增“商品数量统计（同商品自动累加）”卡片：双列展示范围统计与累计统计，支持折叠，按数量降序，管理员/超级管理员可见，进货单视图自动隐藏。
- 收银台页面移除扫码调试模块，替换为“性能分段耗时监控”面板：支持建单/收款分段耗时记录、历史日志（最近20条）、阈值预设切换与扫码状态重置。
- 收银台扫码链路稳定性细节收口：保留 scanner refs 与缓冲重置逻辑，修复键盘扫码处理防重入与类型/构建检查问题。

### Mobile v2.2.4 (2026-07-02) - v7 升级批次收口 + 开票/财务兼容热修

- 完成 v7 升级主线（移动端）：店铺开票信息折叠区、开票字段一键复制、财务角色订单访问与结算建单能力、财务收支城市绑定、库存价值热销/滞销排行榜、V2 进货单独立体系接入。
- 店铺管理能力补齐：开票字段（抬头/税号/开户行/账号）进入店铺编辑链路，新增折叠展示与复制交互，避免占用主卡片空间。
- 财务流水兼容增强：对 `financial_transactions.recurring_frequency` 缺列场景新增查询/写入降级回退，迁移未齐时双端不再直接失败。
- 店铺开票保存回显修复：补齐 `StoreRow -> mapStore` 的 `invoice_title/tax_id/bank_name/bank_account` 映射，修复“保存后看似未生效”的读回缺口。
- 进货单分离链路与财务/库存联动对齐：逐品到货、到货数量可超下单、未到货筛选、到货后财务流水与库存日志同步刷新。

### Web v1.3.4 (2026-07-02) - v7 升级批次收口 + 店铺编辑可达性修复

- 完成 v7 升级主线（Web）：店铺开票信息折叠+复制、财务角色订单页权限放开、财务流水城市绑定、库存价值热销/滞销榜（Top5）、进货单独立表与逐品到货交互。
- 店铺编辑弹层可用性修复：编辑区补齐 `max-height + overflow-y`，头部与关闭按钮在长内容下可达，解决“无法滚动/无法关闭”。
- 财务流水兼容增强：`recurring_frequency` 缺列时自动降级查询与写入，减小数据库迁移不同步导致的线上阻断。
- 店铺开票读回修复：补齐 `StoreRow` 与 `mapStore` 的开票字段映射，确保保存后列表与编辑弹窗可回显。
- 与移动端保持同口径：开票、财务城市绑定、进货单独立链路与报表排行规则保持一致，便于双端验收对账。

### Mobile v2.2.3 (2026-06-29) - post-v6-polish 全量修复收口（报表 + 财务 + 退款 + 日志）

- 库存周转公式重构：由“距上次售出天数”升级为“库存可售天数 = 当前库存 ÷ 日均出库量”，并在图表中补充日均出库展示
- 修复库存周转在省/市维度下的库存口径：统一为“总仓 + 当前维度店铺库存”，云窗（郴州）去重一次避免双计
- 修复“城市筛选 -> 店铺维度动销”云窗分母为 0：云窗店铺分母改为城市总库存口径，不再只取单店库存
- 修复退款单对营收/周转的污染：报表排除 `payment_status` 退款态与 `refunded_items` 证据单
- 移动端订单映射新增零售退款投影：基于剩余正数量行重算零售单金额，并联动 `partial_refunded/refunded` 展示状态
- 回款对账口径升级：`generatePaymentReport(transactions)` 落地实付金额、未结欠款联动，报表列由“城市渠道”拆为“城市 + 渠道门店”
- 城市分级口径升级：由静态店铺等级改为按月营收自动分级（S/A/B）
- 库存日志动作补齐对齐（sell/refund_restore/outbound）与退款恢复链路对应展示
- 体验层修复：库存页文案统一为“库存成本/结算总额”，通知列表底部留白与报表图表可读性/点击详情交互补齐

### Web v1.3.3 (2026-06-29) - post-v6-polish 全量修复收口（报表 + 财务 + 退款 + 日志）

- 与移动端对齐库存周转公式：改为“库存可售天数 = 当前库存 ÷ 日均出库量”，并统一下钻统计口径
- 修复省/市维度库存口径：采用“总仓 + 当前维度店铺库存”，云窗（郴州）去重一次，避免重复计算
- 修复“城市筛选 -> 店铺维度动销”云窗分母异常：改为城市总库存口径
- 报表筛选数据完整性修复：库存周转 tab 在未选店铺时补拉全店铺库存，避免城市/省份维度缺样本
- 退款影响口径对齐：报表排除退款状态与退款明细证据单，营收/周转结果与移动端一致
- 回款对账升级：`generatePaymentReport(transactions)` 启用实收金额计算，输出结构改为“城市 + 渠道门店 + 应收/已回款/未结欠款”
- 城市分级改为按月营收自动分级（S/A/B），不再依赖静态等级字段
- Web 库存日志动作补齐：新增 `sell/refund_restore/outbound` 展示与类型声明，库存日志文案和动作语义一致
- 财务与退款链路对齐：Worker 侧零售退款优先走原子 RPC，退款冲减改为净额（实收-0.6%），历史补录脚本同步校正
- 交互可读性增强：饼图 tooltip/legend 深色可读、库存成本饼图中心总值、周转散点 tooltip 信息增强；移除过渡文案“目标四报表（本轮重点）”

### Mobile v2.2.2 (2026-06-28) - 财务与报表细化计划收口

- 完成财务与业务联动收口：报损、采购到货、零售收款、退款冲减、手续费等自动财务记录链路全量落地
- 完成移动端财务角色专属入口与财务页增强（期初余额编辑权限、多维过滤、余额口径一致）
- 报表重构完成：统一 5 Tab（财务/库存周转/营收/供货统计/销售）并对齐筛选与导出链路
- 新增滞销告警通知闭环：库存周转慢销占比阈值预警 + 系统通知联动
- 完成 v6.4 迁移加固：修复 `max(uuid)` 兼容问题，移除 `COMMIT` 后重复版本更新块

### Web v1.3.2 (2026-06-28) - 财务与报表细化计划收口

- Web 财务页与财务 Store 对齐移动端口径：余额自动计算、交易筛选、权限边界一致
- Web 报表页完成 5 Tab 收口，库存周转/营收/供货/销售视图与移动端指标口径一致
- 滞销告警通知类型与展示文案完成双端统一（含 Profile 通知标签）
- 迁移链文档更新至 v6.7，补齐 `migrate-v6.6-inventory-log-completion.sql` / `migrate-v6.7-refund-reversal-backfill.sql` 与 finance-report-refinement / post-v6-polish 相关发布记录

### Mobile v2.2.1 (2026-06-26) - v6 升级收口 + 验收修复

- 完成移动端 v6 管理能力接入：
  - 个人页集成财务入口（余额总览/流水管理）
  - 集成商品系列管理（新增/编辑/删除）
  - 集成供应商管理入口与权限联动
  - 集成知识库悬浮球（文件浏览/下载，管理员上传删除）
- 权限体系升级：新增 `finance` 角色并统一权限函数（财务、供应商、知识库、报表、库存、收银台等）
- 数据模型升级并与 v6 迁移口径对齐：`product_series`、`suppliers`、`financial_transactions`、`cash_balance`、`knowledge_base_files`，以及店铺扩展字段（合同到期、评级、合同文件）
- 修复移动端“商品系列管理”编辑链路，系列名称/排序值可正常编辑并保存
- 经营数据导出（城市渠道汇总）字段修正：`合作模式` 改为中文标签（寄售/买断/直营）
- 经营数据导出（城市渠道汇总）字段修正：`城市分级` 空值统一显示“未分级”

### Web v1.3.1 (2026-06-26) - v6 控制台能力落地 + 报表可读性修复

- 完成 Web v6 核心模块落地：
  - 新增财务页面（收支流水、分类/店铺/时间筛选、新增编辑删除）
  - 新增供应商页面（资料维护、状态管理、权限隔离）
  - 新增知识库面板（文件上传/下载/删除与角色访问控制）
  - 商品页集成系列管理与店铺定价联动
- 主框架升级：侧边栏与路由入口接入财务/供应商，权限控制函数统一到集中模块
- 数据与迁移对齐：支持 v6.0~v6.2 结构（foundation/finance/knowledge-base）与 `schema_version` 门禁联动
- 报表页新增分组提示：区分“目标四报表（本轮重点）”与“暂保留报表（过渡区）”
- 修复商品页系列下拉在深色背景下的可读性（下拉控件白字、选项黑字白底）
- 经营数据导出（城市渠道汇总）字段修正：`合作模式` 改为中文标签（寄售/买断/直营）
- 经营数据导出（城市渠道汇总）字段修正：`城市分级` 空值统一显示“未分级”

### Mobile v2.2.0 (2026-06-24) - 进货单体验与报表导出准确性修复

- 完成 v5.3~v5.7 数据库升级链路接入（商品 SKU/品类、店铺结算日/合作模式、店铺库存阈值、数量规则、进货单系统、省份排序、库存告警通知）
- 完成双端类型模型升级（`order_kind=purchase`、通知类型扩展、店铺/商品新字段）并保持移动端与 Web 类型口径一致
- 移动端库存/订单/报表全链路纳入进货单：支持创建进货单、订单页确认到货、进货导出与状态流转
- 订单数量规则升级：分销普通商品改为最小起订量校验（`>=30`），样品与零售场景保持独立规则
- 超级管理员权限补齐：关键管理流（店铺、库存、进货、报表）按新角色矩阵统一
- 报表导出升级为三分表经营数据导出（城市渠道汇总 / 单品明细 / 回款对账），并修复移动端导出稳定性
- 修复移动端库存页“进货建单”数量输入框数字偏上/裁切问题：补齐 `lineHeight`、`paddingVertical`、`includeFontPadding` 与 `textAlignVertical`
- 修复 F2 阻塞项：导出前补拉全店铺库存、落地 `store_inventory.min_quantity` 映射、移动端通知类型补齐退款变体

### Web v1.3.0 (2026-06-24) - 报表导出库存覆盖与阈值口径修复

- Web 端完成执行计划全量升级收口：商品/库存/订单/店铺/报表模块与迁移 v5.3~v5.7 对齐
- 进货单双阶段工作流落地：创建进货单 -> 订单页确认到货 -> 库存入账与回退策略统一
- 库存告警通知系统落地：店铺与总库存阈值触发 `inventory_alert`，管理端可见并处理
- 报表导出统一为经营数据三分表，字段与移动端保持同口径
- 修复报表导出库存覆盖：导出前补拉全店铺库存，避免仅按当前筛选店铺造成数据缺口
- 修复店铺库存阈值口径：导出明细“安全库存阈值”优先使用 `store_inventory.min_quantity`
- 与移动端保持报表基础数据链路一致，降低双端导出偏差

### Mobile v2.1.23 (2026-06-21) - 省份维度筛选与导出链路升级

- 省份能力落地：新增 `ProvinceCityFilter` 与静态省市映射，商品/库存/订单/报表筛选支持省份→城市联动
- 报表筛选修复：城市来源升级为“店铺城市 + 订单城市并集”，修复历史数据下城市列表不全
- 店铺库存筛选升级：补齐省份层级，形成“省份→城市→店铺”三级筛选
- 文案统一：筛选中的“未分类”统一改为“未知省份”
- 移动端导出升级：3 个报表导出函数迁移到 `exceljs`，配套 Metro polyfills 与依赖补齐
- 省份管理增强：移动端省份管理 UI 支持排序与交互优化

### Web v1.2.34 (2026-06-21) - 省份筛选体系与报表城市覆盖修复

- 新增 Web `ProvinceCityFilter` 与省份筛选链路，商品/库存/订单/报表筛选与移动端口径一致
- 报表筛选修复：城市选项不再仅依赖店铺集合，补齐订单历史城市覆盖
- 店铺库存筛选补齐省份层级，支持按省份快速收敛城市与店铺范围
- 筛选文案统一为“未知省份”，并与省份映射兜底逻辑一致

### Mobile v2.1.22 (2026-06-18) - 订单页操作优化与结算兼容修复

- 订单页右上操作按钮调整为：`结算`、`上货`、`出库`（并完成上货/出库位置互换）
- 上货建单弹窗搜索增强：支持按商品名/条码/城市联合过滤，修复“搜索框不可用”体感问题
- 结算建单补齐 legacy fallback：兼容旧库 `orders.unit_price` 非空约束（含 `total_amount` / `total-amount` 兼容重试），并保持店铺库存扣减

### Web v1.2.33 (2026-06-18) - 库存告警交互补齐

- 库存页“告警阈值”改为可直接点击编辑并保存（按商品写入 `inventory.min_quantity`）
- 库存页左上“库存告警”卡片支持点击筛选，仅显示告警商品，再次点击可取消筛选

### Web v1.2.32 (2026-06-15) - 结算建单兼容修复与入口文案调整

- 修复结算建单在旧库约束下报错 `null value in column \"unit_price\" of relation \"orders\"`：新增 legacy fallback，兼容 `orders` 旧字段约束后继续完成建单
- 结算 fallback 口径与现网一致：结算价按店铺规则计算（店铺覆盖价 > 店铺折扣率 > 商品折扣价），并同步扣减店铺库存
- 订单页操作文案调整：`结算建单` 改为 `结算`，`新建订单` 改为 `上货`

### Web v1.2.31 (2026-06-15) - 供货单自动接单与结算价口径修复

- 管理员在 Web 订单页创建供货单后改为自动置为 `accepted`，无需再手动点击接单
- 新建结算单弹窗的“结算总额”改为按店铺价规则实时计算（店铺覆盖价 > 店铺折扣率 > 商品折扣价）
- 结算建单时会同步拉取所选店铺专属价，确保总额与店铺折扣配置一致

### Mobile v2.1.21 (2026-06-15) - 双端订单体系升级（移动端能力补齐）

- 注册流程改版：去除店铺字段并补齐“忘记密码”；分销商多店铺登录后支持默认店选择
- 订单体系升级：新增结算建单（admin）、订单类型标签/筛选（供货单/结算单/零售单）
- 报表口径升级：营收仅统计 `settlement + retail`（排除退款状态），并新增独立“供货统计”视图
- 供货单导出模板升级为“上货单”格式：文件名、7列表头、末行合计与业务口径对齐

### Web v1.2.30 (2026-06-15) - 双端订单体系升级（Web 收口）

- 订单页新增 admin「结算建单」入口与流程（不改 POS 收银台），并补齐订单类型标签/筛选
- 报表页营收口径升级为 `settlement + retail`（排除退款），新增独立“供货统计”板块
- 单笔供货单导出切换为“上货单”模板（文件名/列结构/合计行与移动端一致）
- 导出链路改为 `exceljs`，单元格统一水平/垂直居中，已按管理端实操验收通过

### Web v1.2.29 (2026-06-14) - 退款链路稳定性与测试端口兼容

- 修复测试端口 `404/405` 空响应导致的退款误报，退款结果以网关+订单状态双重校验确认。
- 退款后保留订单与明细用于审计：退款商品行归零并展示“已退款明细”，库存同步回退。
- 统一退款口径：全额退款= `refunded` 且金额归零；部分退款= `partial_refunded` 且金额按剩余商品重算（前后端展示一致）。

### Web v1.2.28 (2026-06-14) - 退款语义纠偏（商户侧申请）

- 退款路径从“平台内审批”切换为“商户侧直接发起并受理”，订单页同步移除平台审批区。

### Web v1.2.27 (2026-06-14) - 退款审批上线与抹零保存修复

- 曾上线“退款审批流（申请->审批->执行）”，后续在 v1.2.28 回退为商户侧直连退款。
- 修复按商品抹零保存失败（移除对不存在列 `orders.updated_at` 的写入）；对应迁移：`migrate-v4.9-refund-approval.sql`、`migrate-v4.10-retail-rounding-orders-updated-at-fix.sql`。

### Web v1.2.26 (2026-06-13) - 订单弹窗统一站内交互

- 移除订单页剩余原生浏览器弹窗：导出失败改为站内 `pageNotice` 提示
- 退款提交流程移除二次 `window.confirm`，统一使用站内退款弹窗作为确认入口
- 分销下单/接单/退款/删除等核心交互统一走站内 UI 反馈，避免浏览器原生弹窗打断

### Web v1.2.25 (2026-06-13) - 按商品退款与营收口径修正

- Web 订单页退款交互改为“按商品勾选退款”，不再以手输金额作为主入口
- 订单页统计卡营业额口径调整：排除 `payment_status in (refunded, refund_pending)` 的订单
- 报表页总零售额/折扣成交额/城市店铺销售分布/商品排行/利润聚合同步使用同一排除口径
- 报表卡片文案新增“营收订单 X 笔”，便于核对统计范围

### Web v1.2.24 (2026-06-13) - 收款台抹零金额一致性与退款交互热更

- 修复收款金额不匹配：管理员抹零后会同步 `orders.payment_amount`，后端校验金额与收款台实收金额保持一致
- 增加退款二次确认：提交退款前新增确认提示，降低误操作风险
- 修复退款成功后误报异常：退款成功提示与列表刷新异常解耦，避免“客户已到账但前端提示 failed to fetch”
- 退款后列表即时收敛：全额退款订单在前端列表中即时隐藏，并在后续刷新后保持一致

### Mobile v2.1.20 (2026-06-13) - 分销建单搜索 + 店铺 Chip 选中态修复 + 成本自动同步

- 修复分销建单商品搜索：弹窗内新增搜索框，支持按名称快速过滤商品
- 修复店铺 Chip 选中态可见性：选中态改为渐变背景 + 白色文字，确保双色主题下清晰可见
- 修复店铺专属价编辑回显：切换店铺时自动回填已配置的专属定价
- 数据库：修复 `create_batch_order_atomic` 在无分销商绑定店铺下的校验逻辑
- 数据库：新增商品成本变更自动同步触发器，并完成历史订单成本全量回填

### Web v1.2.23 (2026-06-13) - 店铺专属价入口重构与弹窗滚动修复

- 重构店铺专属价入口：从商品编辑弹窗移至商品卡片 `+` 按钮独立面板，操作更便捷
- 修复商品编辑弹窗滚动：限制弹窗最大高度并支持内部滚动，解决长内容溢出无法操作问题
- 数据库：同步 v4.7 成本自动同步与历史回填逻辑

### Mobile v2.1.19 (2026-06-09) - 移动端零售建单 + 报表月度筛选 + 统计修复

- 新增移动端“零售建单”入口（admin/super_admin）：按店铺选择商品、按店铺库存可用量下单，零售单自动 accepted
- 报表页新增“全部 + 月份(YYYY-MM)”筛选，销售/利润/排行口径联动到所选月份
- 订单统计卡折叠态内容改为条件挂载，彻底消除折叠残影

### Web v1.2.22 (2026-06-09) - 报表月度筛选与导出命名对齐

- 报表页新增“全部 + 月份(YYYY-MM)”筛选，选择月份后全页统计联动刷新
- 报表导出文件名在选月时附加月份后缀（如 `profit-report-2026-06-*.xlsx`）
- `fetchOrders(startDate, endDate)` 在 Web 端补齐并统一 200 条上限口径

### Mobile v2.1.18 (2026-06-09) - 订单统计折叠残影修复与支付渠道信息补齐

- 修复订单页“商品数量统计”在折叠态下的文字残留问题（卡片容器裁剪 + 文本截断）
- 优化订单统计卡片可读性：标题与条目视觉层级提升，长商品名尾部省略
- 订单详情新增“客户支付渠道”展示（零售订单与已记录支付方式订单可见）

### Web v1.2.21 (2026-06-09) - 订单详情弹窗滚动与关闭可达性修复

- 订单详情弹窗增加 `max-height + overflow-y`，长订单可完整滚动查看
- 详情弹窗头部改为 sticky，关闭按钮在滚动场景下始终可见可点击
- 已完成 admin 账号人工回归：详情可滚动且可正常关闭

### Mobile v2.1.17 (2026-05-31) - 订单阅读体验与报表筛选间距微调

- 订单页筛选入口下沉为“搜索 + 筛选弹层”，并增加已选筛选条件摘要 chips，减少顶部固定控件堆叠
- 商品数量统计改为“左本月 / 右累计”双列独立滚动，默认约 3 条可视，支持纵向滑动查看更多
- 商品数量统计卡收紧留白与展开高度，提升同屏信息密度并保持卡片内不溢出
- 报表页筛选区与报表类型切换区间距微调，增强视觉层级与可读性

### Web v1.2.20 (2026-05-31) - 城市→店铺二级筛选对齐移动端

- Web 库存页“店铺库存”视图支持城市→店铺二级筛选，切换城市后店铺列表自动收敛
- Web 订单页新增城市→店铺二级筛选，订单列表与统计卡按同口径联动过滤
- Web 报表页筛选升级为城市→店铺二级筛选，销售/利润/排行统计按筛选结果实时聚合

### Web v1.2.19 (2026-05-30) - 收款台零售订单店铺绑定修复

- 收款台零售建单默认绑定店铺“云窗”，避免 `store_id` 为空导致店铺维度统计缺失
- 新增迁移 `migrate-v4.4-retail-default-yunchuang-store.sql`：历史 `retail` 订单店铺回填到“云窗”
- `create_retail_order_atomic` 在未传 `p_store_id` 时自动回落“云窗”并保持店铺有效性校验
- 紧急补丁：零售订单删除时仅回退到总库存，不再扣减“云窗店铺库存池”（避免总店重复扣减）
- 紧急补丁：超时未支付的零售订单在订单列表刷新时自动清理并回退库存（admin/super_admin/inventory_manager）

### Mobile v2.1.16 (2026-05-31) - 店铺库存筛选分层与超级管理员权限收敛

- 移动端版本基线迭代至 `v2.1.16`
- 库存页“店铺库存”视图改为二级筛选：先选城市，再选该城市下店铺
- 城市切换后店铺选项会自动收敛，避免跨城市店铺混选
- 店铺池库存控制权限收敛为 `super_admin`：普通 `admin` 与 `inventory_manager` 仅可查看，不可编辑/增减

### Mobile v2.1.15 (2026-05-30) - 超级管理员库存可见性与店铺管理体验补齐

- 移动端版本基线迭代至 `v2.1.15`
- 修复超级管理员在库存管理页无法查看店铺库存：现可进入“店铺库存”视图并查看各店铺库存数据
- 店铺管理弹窗改为 `KeyboardAvoidingView + ScrollView`，修复小屏/键盘遮挡导致字段显示不全
- 店铺管理补齐联系人字段与店铺卡片联系人/电话展示，并支持停用后重新启用与删除操作
- 报表页商品名称过长时，支持点击被缩略的商品名弹窗查看完整商品名称
- 紧急补丁：移动端订单删除改为统一调用原子 RPC，零售订单删除时按总库存回退，不再错误扣减云窗店铺库存池
- 紧急补丁：超时未支付的零售订单在订单列表刷新时自动清理并回退库存（admin/super_admin/inventory_manager）

### Web v1.2.18 (2026-05-30) - 收款台扫码稳定性与付款码校验修复

- 修复微信付款码收款失败：前后端统一按微信规则校验 `auth_code`（18 位数字，且前缀 10-15）
- 新增按通道校验：支付宝付款码需匹配 25-30 前缀，避免错通道码进入网关后报错
- 收款台扫码缓冲窗口上调（`scanResetThresholdMs`），降低扫码枪高速输入时的丢码/截断概率
- Worker `/api/payment/collect` 增加通道级校验兜底，非法码在网关前即返回明确错误

### Web v1.2.17 (2026-05-28) - 店铺维度能力补齐（待 admin 实单验收）

- 商品编辑新增店铺专属定价管理（店铺选择 + 覆盖价保存）
- 订单页补齐“修改订单（仅减量）”入口，前端按 `order_item_id/new_quantity` 提交到原子 RPC
- 报表新增店铺筛选与店铺销售占比/店铺库存概览（Web 端）
- 当前状态：本地类型检查通过；受限于 admin 凭据缺失，真实登录验收仍待补测

### Mobile v2.1.14 (2026-05-28) - 报表店铺维度落地（待 admin 实单验收）

- 报表页新增店铺筛选入口，销售/利润维度支持按店铺聚合或过滤
- 新增店铺销售分布与店铺库存概览指标（商品数、总库存、低库存）
- 当前状态：代码与类型检查通过；真实 admin 登录验收待补测

### Web v1.2.16 (2026-05-15) - 退款确认与部分退款支持

- 退款操作新增二次确认弹窗，提交前需确认“退款金额 + 退款原因”
- 支持部分退款：前端可输入任意有效金额，后端按剩余可退金额做严格校验
- 多次退款幂等增强：退款事件键改为带 `out_refund_no/out_request_no`，避免事件冲突

### Web v1.2.15 (2026-05-15) - 订单详情展示与退款入口可达性修复

- 订单详情商品名称缺失时不再回退显示系统 ID，统一显示业务文案“云窗文创”
- `fetchOrderDetail` 补齐支付字段查询（`payment_status/payment_method/payment_transaction_id`），确保退款入口判断正确
- 订单卡片补充显式“退款”按钮（admin / inventory_manager 且已支付零售单），提升入口可发现性

### Web v1.2.14 (2026-05-15) - Web 收款退款闭环上线

- Worker 新增统一退款接口（`/api/payment/refund`），按订单支付渠道自动路由微信/支付宝退款
- 订单详情新增支付状态/渠道/交易号展示，管理员与库存管理员可直接发起全额退款
- 退款事件写入 `payment_events`，订单支付状态回写为 `refunded` / `refund_pending`

### Web v1.2.13 (2026-05-15) - 收款后退款能力补齐

- Worker 新增统一退款接口：按订单支付渠道自动路由到微信/支付宝退款并写入退款事件
- Web 订单详情新增支付状态/渠道/交易号展示，并支持管理员与库存管理员发起全额退款
- 退款后订单支付状态回写为 `refunded` / `refund_pending`，便于前端与对账口径一致

### Web v1.2.12 (2026-05-15) - 微信收款联调兼容性修复

- 修复微信付款码收款 `out_trade_no` 超长问题（UUID 去连字符后按 32 字节发送）
- 修复微信签名头构造鲁棒性（清洗序列号/签名中的非法换行字符）并增强错误诊断
- 修复微信收款接口字段兼容问题：按最小字段集发送并兼容网关端点差异
- 修复收银台扫码枪重复触发导致“一次扫码加购两件”的问题，优化扫码输入节流阈值

### Web v1.2.11 (2026-05-15) - 收银台双通道与微信回调补齐

- 收银台支持支付宝/微信付款码双通道切换，支持按付款码前缀自动推荐支付通道
- Worker 新增微信付款码收款主流程（micropay）与主动查单，并保留支付宝链路
- 新增微信支付回调落账链路：验签、解密、金额校验、幂等事件落库与订单状态更新

### Mobile v2.1.13 (2026-05-24) - 注册档案自愈与登录稳定性修复

- 修复“auth 已存在但 profiles 缺失”导致的登录失败：登录/注册后自动检测并补建分销商档案
- 补充注册元数据校验与错误可读性增强，避免城市 ID 类型异常引发隐式报错
- 新增数据库迁移 `migrate-v3.10-profiles-self-heal.sql`，允许用户仅为自己补建 distributor 档案

### Mobile v2.1.12 (2026-05-24) - 条形码数字显示兼容性微调

- 商品编辑弹窗内条形码区域增加横向安全边距，避免部分机型边缘笔画被裁切
- 条形码数字下方文本放宽字号/行高与字距，并启用自适应缩放，降低“数字显示不全”概率
- 条码图形高度和条宽小幅上调，提升扫码可读性与展示稳定性

### Mobile v2.1.11 (2026-03-19) - 城市排序冲突修复与稳定性加固

- 修复新建城市后 `sort_index` 冲突导致无法继续调整城市排序的问题
- 新建城市默认追加到排序末尾，保证后续扩展时排序行为稳定且可预测
- 增加数据库侧排序防护迁移：去重历史 `sort_index`、插入自动分配末尾、并发场景下保持唯一性

### Mobile v2.1.10 (2026-03-19) - 样品并行下单与分销价展示优先级优化

- 分销订单建单支持“同一商品同时下商品行 + 样品行”（双行并存、独立数量控制）
- 样品行继续遵循“减库存、计成本、不计收入利润”，普通商品行继续保持 5 倍数规则
- 分销商移动端商品价格展示顺序调整为“折扣价优先，零售价次级显示”，降低一线下单认知成本

### Web v1.2.10 (2026-03-19) - 收款台抹零备注与订单交互体验升级

- 收款台支持管理员手动抹零（向下调整应收金额）后再发起客户付款
- 新增订单 `payment_note` 备注链路：抹零会写入“原金额/实收/抹零差额”，便于对账审计
- 订单删除从浏览器 `confirm/alert` 切换为站内弹窗与状态提示，交互与当前 UI 风格一致

### Mobile v2.1.9 (2026-03-16) - 城市排序管理与分销商跨城市浏览优化

- 移动端城市管理新增排序能力：管理员可在城市管理中执行上移/下移，排序会同步影响商品与库存城市展示顺序
- 分销商商品页默认优先置顶所属城市（首次进入自动定位），并允许切换浏览其他城市商品
- 分销商权限继续收敛：仅允许浏览商品，不开放商品编辑；库存页仍保持不可查看
- 订单日期筛选由“指定日期”升级为“自定义时间段”，与 Web 口径一致

### Mobile v2.1.8 (2026-03-13) - 深色模式补齐与单会话稳定性修复

- 移动端非“我的”页面补齐深色模式适配：商品/库存/订单/报表/登录页面统一跟随主题色板
- 订单页指定日期输入框 placeholder 抖动修复：统一输入行高、垂直居中与字体内边距策略
- 单会话登录保护防抖：新增登录后短窗口宽限 + 会话校验重试，修复“登录后被立即踢下线、需重复登录”问题
- 保留单会话约束目标：异常情况下仍会踢下旧会话，但不再误杀当前刚登录设备

### Mobile v2.1.7 (2026-03-13) - 订单类型拆分与头像视觉升级

- 订单模型升级支持 `order_kind`（`distribution` / `retail`），移动端可直接识别并展示“分销订单/零售订单”
- 分销订单与零售订单口径对齐：分销订单维持折扣价与 5 倍数规则，零售订单按零售价结算
- 我的页面头像视觉升级：增强立体感、渐变高光与浅色模式降噪，双端观感更统一
- **支付状态**：Web 收款链路已接入，真实支付联调与回归测试待完成

### Mobile v2.1.6 (2026-03-11) - 会话策略与安装包更新链路修复

- 修复单会话保护：重复登录时仅踢下旧设备，保留最新登录设备在线
- 优化登录校验耗时：会话校验增加节流与并发去重，减少重复 RPC
- 应用内“检查更新”支持二进制更新提示，自动引导到 APK 下载入口
- 补齐 Cloudflare R2 分发链路：Worker 支持 `/mobile/download/latest.apk` 回源下载
- **已知问题（待修复）**：`cloud-window.williamjohnnen.workers.dev` 在部分网络环境下仍存在 443 连通性失败，导致 APK 下载链路未完全打通

### Mobile v2.1.5 (2026-03-10) - 头像/搜索体验与发布链路合并更新

- 头像库调整为动物 / 水果 / 蔬菜分类样式，减少网络依赖并提升可识别度
- 修复“更换头像”后的反馈弹层可读性问题，统一 Toast 文本样式
- 搜索框交互稳定性与布局微调：修复 placeholder 上下抖动，优化商品页搜索框与城市筛选区间距
- 订单页商品数量统计展开区改为自适应内容，避免文本溢出到搜索区域
- 增加 Android 构建后自动同步脚本：EAS 产物下载 -> 上传 R2 -> 回写 Worker 变量
- 增加双远端同步推送命令：一次推送 Gitee + GitHub
- 发布脚本改为显式 `--worker-name`，默认写入 `cloud-window`，避免误写 `*-production`
- 文档补充 Worker/R2 变量安全约束，避免再次覆盖现网配置

### Mobile v2.1.4 (2026-03-10) - 应用内更新（OTA）接入

- 接入 `expo-updates`，支持应用启动自动检查更新
- 我的页面新增“检查更新”入口，可手动拉取并重启应用更新
- 新增文档 `docs/ota-update-checklist.md`，明确可 OTA / 不可 OTA 变更边界

### Web v1.2.9 (2026-03-16) - 报表增强与订单筛选能力补齐

- 报表新增商品动销率排行（销量/库存）并对低动销商品进行风险提示
- 商品利润报表导出与移动端格式对齐（商品名称、销量、零售价、零售总价、折扣价、折扣总收入、总成本、总利润）
- 订单筛选由“指定日期”升级为“自定义时间段”（起止日期）
- 单笔订单删除链路补齐并对齐权限模型，删除时仍保持原子库存恢复

### Web v1.2.8 (2026-03-15) - 会话稳定性 + 城市管理 + 报表可视化升级

- 单会话登录保护稳定性增强：增加登录宽限、会话校验节流/重试与错误分级，降低误踢下线概率
- 商品与库存城市体验升级：商品新增城市选择改为统一 chips 交互，库存页支持按城市筛选
- 管理端新增城市排序能力：支持上移/下移并持久化（配套城市排序迁移与原子交换 RPC）
- 订单能力补齐：Web 端支持单笔订单导出送货单（与移动端字段一致）与安全删除（原子恢复库存）
- 报表升级：销售趋势替换为商品销量排行，并将商品销售额排行改为竖列图表 + Top3 高亮卡片

### Web v1.2.7 (2026-03-14) - 收款台联调稳定性修复

- 收款台扫码建单提速：去除建单成功后的阻塞式订单刷新，fallback 库存回写改为聚合并行更新
- 条码识别增强：商品扫码统一数字归一化，识别误扫付款码（16-24位）并自动切换到付款码模式
- 支付签名修复：支付宝请求签名串改为包含 `sign_type`，回调验签维持排除 `sign/sign_type`，并补充失败排查信息

### Web v1.2.6 (2026-03-13) - 支付长期方案落地与版本门禁

- 建单链路收紧为“原子 RPC 优先”，移除 `request_id` 缺列场景的长期 fallback 依赖
- 新增数据库版本门禁：Web 启动会校验 `get_app_schema_version()`，版本不足直接阻断并提示迁移
- 统一收款金额口径：收款台与零售建单共用零售金额计算逻辑，避免订单金额与支付金额偏差
- 新增支付预检脚本：`npm run payment:precheck --prefix web`（检查 `/health` + `/api/payment/config-check`）

### Web v1.2.5 (2026-03-13) - 订单页统计增强与展示优化

- 订单页改为“摘要优先 + 详情展开”展示，降低长订单对列表可读性的影响
- 增加统计维度：当日 / 本周 / 本月 / 年度 / 累计 / 指定日期
- 新增指定日期筛选输入，双端统计口径保持一致

### Web v1.2.4 (2026-03-13) - 收款台接入与订单类型解耦

- 新增 Web 收款台流程：扫码盒扫商品建单 -> 扫客户付款码收款
- 建单逻辑拆分：
  - 手动建单：分销订单（折扣价、5 倍数规则、不接入真实支付）
  - 收款台扫码建单：零售订单（零售价、数量粒度 1、接入真实支付链路）
- 侧边栏头像与个人页头像逻辑统一（emoji/图片/首字母兜底）
- **支付状态**：真实支付已进入待测试阶段（变量/回调链路就绪，待实单验证）

### Web v1.2.3 (2026-03-10) - 订单与导出链路调整

- 订单详情读取链路重构为“订单头 + order_items 直查 + 商品补全”模式
- Web 订单列表导出统一为 XLSX（不再使用 CSV）
- Cloudflare 部署排查结论已补充：需部署 Vite 的 `web/dist`
- **已知问题（待修复）**：部分历史订单在订单明细中仍可能出现商品聚合异常，需继续做历史数据兼容处理

### Web v1.2.2 (2026-03-10) - 交互补齐与体验升级

- 商品页支持点击卡片进入编辑模式，编辑字段与“新增商品”保持一致
- 订单页补齐新建订单流程可用性，并新增订单详情弹层（由 ">" 按钮打开）
- Web favicon 改为 `assets/ui/login-avatar.png` 同款头像图标

### Mobile v2.1.3 (2026-03-10) - 版本显示修复

- 我的页面版本号改为动态读取 Expo 配置版本，避免硬编码显示不一致
- 关于弹窗版本号同步使用动态版本值

### Web v1.2.1 (2026-03-10) - 交互完善与下单流程补齐

- 商品页优化：条码高可见展示，支持更快扫码识别
- 权限修正：分销商隐藏“新建商品”和商品卡补货快捷按钮
- UI统一：商品页城市筛选改为与控制台风格一致的 chips 交互
- 订单页补齐移动端能力：分销商可在 Web 端新建订单（购物车、搜索、5 的倍数校验）
- 小修复：Web 新建商品流程补齐 EAN-13 条码生成，并在商品卡渲染可扫描条形码图形（不变更 Web 版本号）

### Web v1.1.0 (2026-03-10) - 管理台功能打通

- Web 与后端正式打通：商品新增、库存增减、扫码/条码入库、订单接单、个人资料编辑
- 新增库存变动日志（`inventory_logs`）及对应迁移 `migrate-v2.5-inventory-logs.sql`
- 报表改为真实订单数据计算（非 mock），支持销售趋势/商品排行 CSV 导出

### Web v1.0.0 (2026-03-10) - Web 首次上线

- 完成 Web 控制台部署上线（左侧导航 + 科技感 UI 基础框架）
- 建立独立 Web 工程目录 `web/`，与移动端解耦

### v2.2 (2026-03-08) - 订单优化

**订单新建优化：**
- 商品数量调整：+/- 按钮一次增减5件
- 支持直接输入数量（必须是5的倍数）
- 点击数量进入编辑模式，输入框初始为空
- 下单时验证所有商品数量，不足5的倍数无法提交
- 商品名称前显示缩略图（与商品页一致）

**管理员订单页面优化：**
- 分销商筛选标签尺寸缩小（100x30）
- 商品数量统计卡片：本周/累计改为左右并排显示

**报表功能增强：**
- 销售报表新增：商品销售额排行榜
- 销售报表新增：商品动销率排行榜（销售数量/库存）
- 动销率低于0.5的商品标红显示

**订单导出：**
- 每笔订单支持导出Excel送货单
- 格式：商品名称、送货数量、单价、查收（留空）
- 首行显示送货日期

### v2.1 (2026-03-06) - UI优化

**新增依赖：**
- `lucide-react-native` - 矢量图标库（替代emoji）
- `react-native-toast-message` - 非阻断提示（替代Alert）
- `react-native-gifted-charts` - 专业图表（柱状图+饼图）

**UI改进：**
- Tab栏图标：emoji → Lucide矢量图标（Package/BarChart2/ShoppingCart/TrendingUp/User）
- 菜单图标：emoji → Lucide矢量图标（User/MapPin/Users/WifiOff/Bell/Info）
- 提示方式：Alert.alert → Toast.show（非阻断提示，粉蓝主题样式）
- 报表图表：自定义ChartBar → gifted-charts BarChart + PieChart
- 搜索功能：商品/订单/库存页面新增搜索栏
- 空状态：纯文本 → Lucide图标 + 描述文案
- 库存按钮：文字按钮 → Lucide图标按钮（ChevronsDown/Minus/Pencil/Plus/ChevronsUp）
- 导出按钮：纯文字 → Download图标 + 文字

**设计系统：**
- 粉蓝渐变主题（#FF6B9D → #5B8DEF）
- Toast配置：success/error/info三种样式，圆角12px，左边框彩色指示

### v2.0 - 条码与入库/出库

**条码功能：**
- 商品添加时自动生成 EAN-13 条码（2000000前缀 + 5位序号 + 校验位）
- 条码字段存储在 `products.barcode`，带唯一索引
- 支持扫码枪快速输入（13位数字自动识别）

**入库功能：**
- 入口：库存管理页面右上角"入库"按钮
- 流程：扫描/输入条码 → 自动识别商品 → 输入数量 → 确认入库
- 权限：仅管理员/库存管理员可用

**出库功能：**
- 入口：订单页面"出库"按钮
- 流程：扫描/输入条码 → 自动识别商品 → 输入数量 → 确认出库
- 特点：出库时自动创建订单并扣减库存
- 结算：按零售价生成订单（`retail_price == discount_price`）
- 权限：仅管理员/库存管理员可用

**条码显示与补齐：**
- 管理员在商品卡片与编辑弹窗可查看条码
- 对已有无条码商品，可使用“生成条码”按钮批量补齐

**数据库迁移：**
- `migrate-v2.3-barcode.sql`：添加 barcode 字段和索引
- `migrate-v2.4-atomic-order-workflows.sql`：新增事务化 RPC（下单与出库原子执行）
