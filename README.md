# 云窗文创 · 供销管理系统

基于 **Expo + React Native + TypeScript + Supabase** 的供销管理系统（移动端 + Web 端）。

> 品牌文案已更新为：**云窗文创 / 供销管理系统**。

## 功能总览（v2）

### 1) 角色与权限

- `admin`：全权限（商品、库存、订单、通知接单、分销商管理、报表）
- `inventory_manager`：商品与库存管理
- `distributor`：仅查看所属城市商品，仅查看自己订单，可下单

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
- 导出：`xlsx` + `expo-print` + `expo-sharing` + `expo-file-system`
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
9. 执行 `supabase/storage-policies.sql`

#### 旧项目升级（v1 -> v2）

1. 执行 `supabase/migrate-v2.sql`
2. 执行 `supabase/migrate-v2.1-notifications.sql`
3. 执行 `supabase/migrate-v2.2-unit-cost-snapshot.sql`
4. 执行 `supabase/migrate-v2.3-barcode.sql`
5. 执行 `supabase/migrate-v2.4-atomic-order-workflows.sql`
6. 执行 `supabase/migrate-v2.5-inventory-logs.sql`
7. 执行 `supabase/migrate-v2.8-payment-events.sql`
8. 执行 `supabase/migrate-v2.9-order-kinds-retail.sql`
9. 执行 `supabase/storage-policies.sql`

### 4. 启动应用

```bash
npx expo start
```

### 5. 启动 Web 端（v1.2.4）

```bash
npm run web:v2
```

> Web 端目录：`web/`（与移动端代码完全分离）

#### Web 环境变量（Cloudflare/本地）

Web 登录依赖以下变量（推荐使用 `VITE_` 前缀）：

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

> 兼容 `EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY`，但部署时建议统一使用 `VITE_*`。

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

- `npx tsc --noEmit`
- `npx expo start`
- 手工回归主链路：
  1. 分销商下单
  2. 管理员通知中心接单
  3. 分销商收到“已接单”通知

## 后续规划

- [ ] 直营店 Web 收款正式接入：微信 Native 支付 + 支付宝当面付（含签名、回调验签、幂等、对账）
- [ ] Cloudflare Worker 支付生产配置（商户密钥、回调地址白名单、监控告警）
- [ ] 通知链路自动化测试（store 层）
- [ ] 推送通知接入（FCM/APNs）
- [ ] 更多报表维度与导出模板

## 更新日志

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
