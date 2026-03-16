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
| src/types/index.ts | TypeScript interfaces |
| src/theme.ts | Design tokens (Colors, Radius, Shadow) |
| src/lib/supabase.ts | Supabase client |
| src/utils/barcode.ts | EAN-13 generation/validation |

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
1. schema.sql -> 2. migrate-v2.1-notifications.sql -> 3. migrate-v2.2-unit-cost-snapshot.sql -> 4. migrate-v2.3-barcode.sql -> 5. migrate-v2.4-atomic-order-workflows.sql -> 6. migrate-v2.5-inventory-logs.sql -> 7. migrate-v2.8-payment-events.sql -> 8. migrate-v2.9-order-kinds-retail.sql -> 9. migrate-v3.0-request-id-compat.sql -> 10. migrate-v3.1-schema-version-gate.sql -> 11. migrate-v3.2-orders-quantity-compat.sql -> 12. migrate-v3.3-city-sort-order.sql -> 13. migrate-v3.4-admin-city-sort-and-safe-order-delete.sql -> 14. migrate-v3.5-order-delete-permissions.sql -> 15. storage-policies.sql

**Upgrade v1->v2:**
1. migrate-v2.sql -> 2-15 same as above

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

## RELEASE NOTES

- Current mobile baseline: `v2.1.9`
- Current web baseline: `v1.2.9`
- Order split baseline: 手动建单 = `distribution`（折扣价 + 5倍数）；收款台扫码建单 = `retail`（零售价 + 粒度1 + 支付链路）
- Payment integration status: Web 已接入，真实支付联调/回归 **pending**
- Latest web stabilization: 商品动销率排行 + 利润报表导出与移动端口径对齐 + 订单自定义时间段筛选 + 单笔删除权限链路补齐
- Latest mobile stabilization: 城市管理支持排序（上移/下移） + 分销商所属城市置顶并可浏览其他城市商品（只读） + 订单改为自定义时间段筛选
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
