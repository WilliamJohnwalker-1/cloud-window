# AGENTS.md

**Stack:** Expo 55 + React Native 0.83 + TypeScript + Supabase + Zustand

## OVERVIEW

供销管理系统 v2 — 多角色供应链管理（管理员/分销商/库存管理员）。支持城市维度商品、订单流程、通知接单、报表导出、条码入库/出库。

## COMMANDS

```bash
# Development
npx expo start              # Start Metro bundler
npx expo start --clear       # Clear cache and start
npm run web:v2               # Start Vite web app (new Web UI)

# Type checking
npx tsc --noEmit             # TypeScript check (REQUIRED before commits)

# Platform-specific
npx expo start --android     # Android
npx expo start --ios         # iOS
npm run build --prefix web   # Build Vite web app
npm run cf:deploy            # Cloudflare Worker deploy with --keep-vars
npm run cf:version           # Safe deploy alias with --keep-vars (for non-empty Version command)
npm run cf:version:upload    # Raw versions upload (WARNING: may override Dashboard Text vars)
eas update --channel production --message "mobile ota: xxx"  # Publish OTA update
eas build --platform android --profile production             # Build production APK
npm run release:android:sync -- --build-id <EAS_BUILD_ID> --worker-name cloud-window  # Sync APK to R2 + write worker secrets (default worker env)
npm run push:both            # Push to Gitee and GitHub together

# Dependencies
npm install                  # Install dependencies
npx expo install <pkg>       # Install Expo-compatible package
```

## AUTOMATION SAFETY RULES (MANDATORY)

- **禁止创建测试账号（含子任务/子代理）**：
  - 不允许在 Supabase Auth 中注册任何临时账号
  - 不允许向 `profiles`/`auth.users` 写入测试用户
  - 账号相关联调仅使用已有业务账号，由人工执行
- **禁止污染生产/共享数据库**：
  - 不执行“注册、插入测试用户、提权测试用户”等脚本
  - 若发现此类临时脚本，必须先删除并汇报
- **双端推送策略（npm run push:both）**：
  - Gitee 正常推送
  - GitHub 若失败，**只允许单次尝试，不自动重试**
  - 失败后立即通知人工接管

**No test framework configured** — manual testing required.

## CODE STYLE

### Imports (Strict Order)

```typescript
// 1. React/React Native
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ... } from 'react-native';

// 2. Third-party libraries (alphabetical)
import { LinearGradient } from 'expo-linear-gradient';
import { Package, Search } from 'lucide-react-native';
import Toast from 'react-native-toast-message';

// 3. Internal imports (relative path with ../)
import { useAppStore } from '../store/useAppStore';
import { Colors, Shadow, Radius } from '../theme';
import type { ProductWithDetails } from '../types';
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|----------|
| Components | PascalCase | ProductsScreen, LoginScreen |
| Functions | camelCase | fetchProducts, handleSave |
| Variables | camelCase | isLoading, filterCityId |
| Constants | camelCase | Colors, Radius, Shadow |
| Types/Interfaces | PascalCase | Product, OrderItem, AppState |
| Files | PascalCase for screens | ProductsScreen.tsx |
| Utilities | camelCase | barcode.ts, supabase.ts |

### TypeScript Rules

- **Strict mode enabled** ("strict": true in tsconfig.json)
- **Use type for imports**: import type { Product } from '../types'
- **Avoid any**: Use proper types or unknown with type guards
- **Return types for async**: Promise<{ error: Error | null }>
- **Number conversion**: Always use Number() or parseInt(), never implicit

### Error Handling Pattern

All async operations follow this pattern:

```typescript
// Store functions
const addProduct = async (product) => {
  try {
    const { data, error } = await supabase.from('products').insert(product);
    if (error) throw error;
    await fetchProducts();
    return { error: null };
  } catch (error) {
    return { error: error as Error };
  }
};

// UI components
const handleSave = async () => {
  const { error } = await addProduct(formData);
  if (error) {
    Toast.show({ type: 'error', text1: '错误', text2: error.message });
    return;
  }
  Toast.show({ type: 'success', text1: '成功', text2: '商品已添加' });
};
```

### Toast vs Alert

- **Toast** (Toast.show): Non-blocking feedback (success/error/info)
- **Alert** (Alert.alert): Confirmation dialogs with buttons

### Styling Rules

- **NEVER hardcode colors** — use Colors from ../theme
- **NEVER hardcode spacing/radius** — use Spacing, Radius from theme
- **Use StyleSheet.create** at component bottom
- **Shadows**: Use Shadow.card, Shadow.soft, Shadow.elevated

### Component Structure

```typescript
export default function ProductsScreen() {
  // 1. Store hooks
  const { products, fetchProducts } = useAppStore();
  // 2. Local state
  const [modalVisible, setModalVisible] = useState(false);
  // 3. Derived state
  const isAdmin = user?.role === 'admin';
  // 4. Effects
  useEffect(() => { fetchProducts(); }, []);
  // 5. Handlers
  const handleSave = async () => { /* ... */ };
  // 6. Render helpers
  const renderItem = ({ item }) => { /* ... */ };
  // 7. Return JSX
  return <View style={styles.container}>{/* ... */}</View>;
}
// 8. Styles at bottom
const styles = StyleSheet.create({ /* ... */ });
```

## ARCHITECTURE

### State Management (Zustand)

- **Single store**: src/store/useAppStore.ts
- **Persisted**: Only user and isOfflineMode persisted to AsyncStorage
- **Pattern**: All data fetching goes through store, never direct Supabase calls

### Data Flow

Component -> useAppStore -> Supabase -> useAppStore -> Component

### Role-Based Access

```typescript
const isAdmin = user?.role === 'admin';
const isDistributor = user?.role === 'distributor';
const isAdminOrManager = user?.role === 'admin' || user?.role === 'inventory_manager';
```

## KEY FILES

| File | Purpose |
|------|---------|
| App.tsx | Entry, navigation, Toast provider |
| src/store/useAppStore.ts | All state and business logic |
| src/store/useFinanceStore.ts | Mobile finance state and finance RPC integration |
| src/types/index.ts | TypeScript interfaces |
| src/theme.ts | Design tokens (Colors, Radius, Shadow) |
| src/lib/supabase.ts | Supabase client |
| src/utils/barcode.ts | EAN-13 generation/validation |
| src/screens/FinanceScreen.tsx | Mobile finance role dedicated finance screen |
| web/src/screens/FinanceScreen.tsx | Web finance ledger page (balance + breakage form) |

## DOMAIN RULES (IMPORTANT)

- 入库、出库按钮仅 `admin` / `inventory_manager` 可见与可用
- 分销商不提供入库/出库快捷功能（仅下单流程）
- 出库创建的订单按零售价计算：
  - `total_retail_amount = retail_price * qty`
  - `total_discount_amount = retail_price * qty`
  - `order_items.discount_price = retail_price`
- 条码策略：
  - 新增商品自动生成 EAN-13（`generateEAN13`）
  - 旧商品可通过 `backfillBarcodes()` 批量补齐
  - 商品页管理员可查看条码（卡片 + 编辑弹窗）
- **订单数量规则（重要）：**
- 所有订单商品数量必须是 **5 的倍数**
- 新建订单：+/- 按钮一次增减5件
- 支持直接输入数量，输入时自动清空输入框
- 确认下单时会验证，不满足5的倍数则提示具体商品
- 样品行例外：分销订单中标记为样品的商品不受5倍数限制（通常按1件样品下单）
- 例外：Web 收款台扫码建单为线下收银场景，扫码每次加购 1 件，使用独立建单逻辑

## WEB PAYMENT STATUS (TODO)

- 当前 Web 已提供“扫码盒扫商品创建订单 -> 扫客户付款码收款”的收款台页面（面向 admin / inventory_manager）。
- 移动端暂不承担扫码盒收款职责（扫码盒能力以 Web 为主）。
- 域名策略：支付接口走 `pay.yunchuang888888.com`；APK 下载走根域 `yunchuang888888.com/mobile/*`。
- 当前状态：支付链路代码已接入，**真实支付待测试**（待实单验证回调、对账与异常重试链路）。
- **仍需继续推进生产级支付能力**：
  - 微信 Native 支付正式签名与回调验签
  - 支付宝异常场景补齐（超时撤销/重试策略）
  - 支付回调幂等、防重放、金额校验与对账
  - Cloudflare Worker 生产密钥管理与监控告警

## DATABASE MIGRATIONS

Execute in Supabase SQL Editor (paste SQL content, not file path):

**New project:**
41. migrate-v6.0-foundation.sql -> 42. migrate-v6.1-finance.sql -> 43. migrate-v6.2-knowledge-base.sql -> 44. migrate-v6.3-finance-integration.sql -> 45. migrate-v6.4-financial-backfill.sql -> 46. migrate-v6.5-inventory-slow-moving-alert.sql -> 47. migrate-v6.6-inventory-log-completion.sql -> 48. migrate-v6.7-refund-reversal-backfill.sql -> 49. migrate-v6.8-retail-income-category-normalization.sql -> 50. migrate-v7.0-store-invoice-fields.sql -> 51. migrate-v7.1-finance-city-binding.sql -> 52. migrate-v7.2-purchase-order-separation.sql -> 53. migrate-v7.3-retail-single-pool-and-log-completion.sql -> 54. migrate-v7.4-store-invoice-contact-fields.sql -> 55. migrate-v7.5-external-channel-orders.sql

**Upgrade v1->v2:**
1. migrate-v2.sql -> 2-55 same as above

## GOTCHAS

1. **min(uuid) does not exist**: Use ARRAY_AGG(...)[1]::uuid
2. **Storage RLS**: Upload path must be {auth.uid()}/products/...
3. **LF/CRLF warnings**: Normal on Windows, Git auto-converts
4. **Metro cache issues**: Run npx expo start --clear

## VERIFICATION CHECKLIST

Before committing:
- [ ] npx tsc --noEmit passes
- [ ] npx expo start loads without errors
- [ ] Manual test: Distributor login -> Create order -> Admin accept
- [ ] npm run payment:precheck --prefix web
- [ ] Web manual test: barcode outbound flow + payment mock flow
- [ ] 验证未创建任何测试账号/测试用户写入脚本

## RELEASE NOTES

- Current mobile baseline: `v2.2.7`
- Current web baseline: `v1.3.10`
- Order split baseline: 手动建单 = `distribution`（折扣价 + 5倍数）；收款台扫码建单 = `retail`（零售价 + 粒度1 + 支付链路）
- Payment integration status: Web 已接入，真实支付联调/回归 **pending**
- Latest web stabilization: 省份筛选体系已落地（商品/库存/订单/报表），报表城市筛选改为“店铺+订单并集”修复历史城市不全；店铺库存补齐省份→城市→店铺三级筛选；“未分类”统一为“未知省份”
- Latest mobile stabilization: 省份维度全链路升级完成（新增 ProvinceCityFilter、静态省市映射、省份管理排序）；商品/库存/订单/报表筛选统一省份→城市联动；店铺库存补齐省份筛选；移动端 3 个导出函数升级为样式化 xlsx 导出并修复报表导出链路稳定性
- Latest store-management wave: Web 店铺定价管理与订单修改 UI、双端报表店铺维度均已完成并通过 admin 手工验收
- Latest finance-report wave: v6.3/v6.4/v6.5 全链路收口后，post-v6-polish 已继续补齐 v6.6/v6.7（主仓库存日志补全、退款净额冲减历史补录修正）；双端财务页与报表 5-tab 已完成并对齐
- Latest migration hardening: `migrate-v6.4-financial-backfill.sql` 已修复 `max(uuid)` 兼容问题（改用 ARRAY_AGG uuid-safe 取值）并移除 `COMMIT` 后重复版本更新块
- Latest v7 purchase-order wave: `migrate-v7.0/v7.1/v7.2` 已落地（店铺开票信息字段、财务交易城市绑定、V2 进货单独立表与逐品到货/回滚链路）
- Latest v7 upgrade-batch closure: 双端店铺开票折叠+复制、finance 订单权限放开、财务收支城市绑定、库存价值热销/滞销排行榜、进货单独立链路均已收口
- Latest post-v7 hotfixes: 修复 Web 店铺编辑弹层滚动与关闭可达性；补齐 `financial_transactions.recurring_frequency` 缺列降级兼容；修复店铺开票保存后回显映射缺口
- Latest web cashier wave: Web 订单页新增商品数量统计卡（范围/累计双列，admin/super_admin 可见，进货单隐藏）；收银台移除扫码调试模块并新增性能分段耗时监控面板（建单/收款计时、20条历史、阈值预设、扫码状态重置）
- Latest web search+cashier hotfix: 全局搜索结果点击支持跳转并定位高亮到商品/库存/订单；未支付零售单超时自动删除规则由 30 分钟调整为 10 分钟，并补回支付成功后的清理触发链路
- Latest cashier perf hardening: 收银台 `fetchOrderDetail` 并行化、Worker `/collect` 财务补写异步化与 `/status` 去冗余门控已落地；前端收款后刷新改非阻塞、轮询容错与单次 paid 收口修复（避免误报 failed 与成功语音重复）
- Latest inventory-log hardening wave: 重写 `migrate-v7.3-retail-single-pool-and-log-completion.sql` 对齐零售单池语义；补齐 Web 供货/零售 fallback 扣减日志；双端库存日志备注统一短原因文案，确保后续日志准确可读
- Latest invoice+rollback hotfix: 新增 `migrate-v7.4-store-invoice-contact-fields.sql`，店铺开票联系电话/开票地址改为独立字段（不再复用联系人电话/店铺地址）；补齐 distribution 删单店铺池回滚日志（`删单回滚(店铺池)`）。
- Latest external-channel wave: 外部渠道订单录入（Web）+ 双端展示兼容 + 零售财务 city_id 修复 + 移动端启动更新弹窗，迁移链延伸至 v7.5
- Latest payment-guard wave: Worker `/collect` 与 `/status` 增加支付/退款态门禁与状态防降级；Web 收银台补齐 collecting/paid 防重入；双端订单页补齐已支付订单删单拦截，收款幂等与支付态一致性进一步加固
- v2.1.5 changelog should be treated as a merged block: avatar library/feedback optimization + search box/layout stability optimization + release pipeline hardening.
- Worker publish strategy: **do not manually deploy from local workflow**; code is synced via repository automation.
- Android build release flow:
  1. `eas build --platform android --profile production`
  2. `npm run release:android:sync -- --build-id <EAS_BUILD_ID> --worker-name cloud-window`
  3. `npm run push:both`

## APK DOWNLOAD INCIDENT PLAYBOOK

When user says "修复 APK 下载问题" or similar, prioritize these solutions in order:

1. **Cloudflare custom domain for Worker/R2** (preferred)
   - Keep Worker + R2 logic unchanged
   - Move download endpoint from `*.workers.dev` to custom domain route
   - Update client API base URL to custom domain

2. **GitHub Releases as APK mirror**
   - Upload APK as release asset
   - Worker only returns release download URL in manifest

3. **Dual-source download fallback**
   - Primary: Worker/R2 route
   - Secondary: alternate CDN/object storage URL
   - Client auto-fallback on connectivity failure

4. **Domestic CDN/object storage fallback (if CN network issues)**
   - OSS/COS/Qiniu as backup source

5. **Store-based distribution path (long-term)**
   - In-app version check + jump to store page

Execution rules:
- Diagnose network reachability (`/health`, `/mobile/latest.json`, `/mobile/download/latest.apk`) first
- Prefer minimum-change path (domain/routing) before replacing storage architecture
- Document root cause and final selected path in README release notes
