# 云窗文创 · 供销管理系统

基于 **Expo + React Native + TypeScript + Supabase** 的移动端供销管理系统（v2）。

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

## 技术栈

- 前端：Expo ~55、React Native 0.83、TypeScript
- 状态管理：Zustand + AsyncStorage
- 后端：Supabase（PostgreSQL / Auth / Storage）
- 导出：`xlsx` + `expo-print` + `expo-sharing` + `expo-file-system`
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
5. 执行 `supabase/storage-policies.sql`

#### 旧项目升级（v1 -> v2）

1. 执行 `supabase/migrate-v2.sql`
2. 执行 `supabase/migrate-v2.1-notifications.sql`
3. 执行 `supabase/migrate-v2.2-unit-cost-snapshot.sql`
4. 执行 `supabase/migrate-v2.3-barcode.sql`
5. 执行 `supabase/storage-policies.sql`

### 4. 启动应用

```bash
npx expo start
```

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

- [ ] 通知链路自动化测试（store 层）
- [ ] 推送通知接入（FCM/APNs）
- [ ] 更多报表维度与导出模板

## 更新日志

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
