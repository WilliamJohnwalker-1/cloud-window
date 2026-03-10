# AGENTS.md

**Stack:** Expo 55 + React Native 0.83 + TypeScript + Supabase + Zustand

## OVERVIEW

供销管理系统 v2 — 多角色供应链管理（管理员/分销商/库存管理员）。支持城市维度商品、订单流程、通知接单、报表导出、条码入库/出库。

## CURRENT MOBILE VERSION

- 当前移动端版本：`v2.1.5`（2026-03-10）
- 本次重点：头像选择体验优化（动物/水果/蔬菜分类）、Toast 可读性修复、搜索框稳定性与布局微调、订单统计展开区自适应

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
eas update --channel production --message "mobile ota: xxx"  # Publish OTA update
eas build --platform android --profile production             # Build production APK

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

## WEB PAYMENT STATUS (TODO)

- 当前 Web 出库已支持“生成收款码 -> 确认收款 -> 出库扣减”的流程骨架。
- **尚未完成生产支付接入**（必须继续推进）：
  - 微信 Native 支付正式签名与回调验签
  - 支付宝当面付正式签名与回调验签
  - 支付回调幂等、防重放、金额校验与对账
  - Cloudflare Worker 生产密钥管理与监控告警

## DATABASE MIGRATIONS

Execute in Supabase SQL Editor (paste SQL content, not file path):

**New project:**
1. schema.sql -> 2. migrate-v2.1-notifications.sql -> 3. migrate-v2.2-unit-cost-snapshot.sql -> 4. migrate-v2.3-barcode.sql -> 5. migrate-v2.4-atomic-order-workflows.sql -> 6. migrate-v2.5-inventory-logs.sql -> 7. migrate-v2.6-order-item-rls-hardening.sql -> 8. migrate-v2.7-session-avatar.sql -> 9. storage-policies.sql

**Upgrade v1->v2:**
1. migrate-v2.sql -> 2-9 same as above

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
- [ ] Web manual test: barcode outbound flow + payment mock flow
