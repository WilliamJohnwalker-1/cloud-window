# 生产环境部署指南

## 版本信息

- **当前版本**: 2.1.0
- **构建时间**: 2026-03-08
- **Git Commit**: 461631d

---

## 📱 Android 生产构建

### 方法 1: EAS Build（推荐）

#### 前置配置

如果这是第一次使用 EAS Build，需要先配置：

```bash
# 1. 安装 EAS CLI（如果未安装）
npm install -g eas-cli

# 2. 初始化 EAS 配置
eas build:configure

# 这会创建 eas.json 文件
```

#### 构建命令

```bash
# Android APK 构建参数
eas build \
  --platform android \
  --profile production \
  --output ./android-build/production-2.1.0.apk
```

#### 预计时间

- Android: 约 15-20 分钟
- 需要联网构建

#### 构建产物

- 文件位置: `android-build/production-2.1.0.apk`
- 文件大小: 约 50-80 MB

### 方法 2: 本地构建（需要 Android Studio）

#### 环境要求

- Android Studio（推荐 2024.1 或更新）
- Android SDK（API 33+）
- Java JDK 11+
- Gradle

#### 构建命令

```bash
# 1. 启动开发服务器
npx expo start --clear

# 2. 在 Android Studio 中构建
# File → New → Import Project
# 选择此项目目录
# Build → Build Bundle(s) / APK(s) → Build APK(s)
```

---

## 🍎 iOS 生产构建

### 方法 1: EAS Build（推荐）

#### 前置配置

iOS 需要额外的证书配置：

1. **Apple Developer 账户**（$99/年）
   - 如果没有，可以创建免费开发者账户

2. **配置证书**
   ```bash
   # 初始化 EAS 配置时会提示
   eas build:configure
   # 按提示完成证书设置
   ```

#### 构建命令

```bash
# iOS IPA 构建参数
eas build \
  --platform ios \
  --profile production \
  --output ./ios-build/production-2.1.0.ipa
```

#### 预计时间

- iOS: 约 20-30 分钟
- 需要联网构建 + 证书验证

#### 构建产物

- 文件位置: `ios-build/production-2.1.0.ipa`
- 文件大小: 约 80-120 MB

### 方法 2: 本地构建（需要 Mac + Xcode）

#### 环境要求

- Mac 电脑（Apple Silicon 或 Intel）
- Xcode 15+
- Apple Developer 账户
- CocoaPods

#### 构建命令

```bash
# 1. 安装 CocoaPods
cd ios && pod install

# 2. 在 Xcode 中打开项目
open ios/inventory-app.xcworkspace

# 3. 选择目标
# Product → Archive
# 按提示完成签名和打包
```

---

## 🔍 快速测试建议（开发阶段）

在准备完整构建之前，建议先用 Expo Go 进行完整测试：

### 启动方式

```bash
# 清除缓存并启动
npx expo start --clear --port 8083

# 手机扫描连接的二维码
# Expo Go 自动加载最新代码
```

### 测试清单

#### 基础功能

- [ ] 管理员登录
- [ ] 分销商登录
- [ ] 商品管理（添加/编辑/删除）
- [ ] 入库/出库功能
- [ ] 订单创建（数量5的倍数验证）
- [ ] 订单管理（接单/删除/导出Excel）
- [ ] 报表查看（销量/销售额/动销率）

#### UI/UX优化（2.1.0 新增）

- [ ] 统计卡片折叠动画展开/折叠
- [ ] Filter Chips 触觉反馈
- [ ] Toast 消息弹跳动画
- [ ] 不健康商品视觉警告（Reports）
- [ ] 按钮按压动画反馈

#### 边界情况

- [ ] 网络断开时的离线模式
- [ ] 数量输入非法值提示
- [ ] 库存不足提示
- [ ] 无网络时显示 Toast 错误

---

## 📋 构建前检查清单

### 代码质量

- [x] TypeScript 编译通过 (`npx tsc --noEmit`)
- [x] 无 Lint 错误
- [x] Git 推送成功到远程仓库
- [ ] 版本号已更新为 2.1.0

### 测试要求

- [ ] 管理员账号测试完成
- [ ] 分销商账号测试完成
- [ ] 新增 UI/UX 功能测试完成
- [ ] 兼容性测试（Android 10+, iOS 14+）

### 配置确认

- [ ] Supabase 连接正常
- [ ] expo-haptics 已安装并可用
- [ ] AnimatedTouchable 组件正常工作
- [ ] LayoutAnimation 在 Android 已启用

---

## 🚀 推荐构建流程

### Step 1: 最终验证

```bash
# 清除缓存重启
npx expo start --clear --port 8083

# 彻底测试所有功能
# 摇晃手机 → Reload 重新加载
# 登录账号 → 测试所有模块
```

### Step 2: 选择构建方式

#### 如果有构建环境（Android Studio / Xcode）

**Android**:
```bash
# 方法 A: 使用 EAS（快速）
eas build --platform android --profile production

# 方法 B: 本地 Android Studio（控制更细）
npx expo run:android --variant release
```

**iOS**:
```bash
# 方法 A: 使用 EAS（快速）
eas build --platform ios --profile production

# 方法 B: 本地 Xcode（控制更细）
cd ios && xcodebuild -workspace inventory-app.xcworkspace -scheme inventory-app archive
```

#### 如果没有构建环境

**使用 EAS Build**:
```bash
# 1. 安装 EAS CLI
npm install -g eas-cli

# 2. 配置 EAS
eas build:configure

# 3. 构建
eas build --platform android --profile production
```

### Step 3: 测试构建产物

**Android APK**:
```bash
# 安装到手机
adb install android-build/production-2.1.0.apk

# 或者直接分享 APK 文件发送给测试设备
```

**iOS IPA**:
```bash
# 使用 TestFlight 安装
# 或使用 AltStore/Apple Configurator 安装
```

### Step 4: 生产环境测试清单

#### Android APK 测试

- [ ] APK 可正常安装
- [ ] 应用启动无崩溃
- [ ] 所有 UI/UX 动画流畅
- [ ] 触觉反馈工作正常
- [ ] 所有功能完整可用
- [ ] 离线模式工作正常

#### iOS IPA 测试

- [ ] IPA 可正常安装
- [ ] 应用兼容所有测试的 iOS 版本（14+）
- [ ] 所有 UI/UX 动画流畅
- [ ] 触觉反馈工作正常
- [ ] 所有功能完整可用
- [ ] 离线模式工作正常

---

## 📧 分发 APK/IPA 的方法

### Android APK 分发

1. **直接分享文件**
   - 微信/QQ 传输
   - 邮件附件
   - 网硬盘（百度网盘、阿里云盘）

2. **使用第三方分发平台**
   - Google Play Store（发布到商店）
   - 蒲公英、fir.im（内部分发）
   - 企业内部分发系统

### iOS IPA 分发

1. **测试飞行 TestFlight**
   - 上传到 Apple Connect
   - 通过 TestFlight 分发给测试用户

2. **第三方分发**
   - AltStore / AltStore 服务器
   - 企业签名证书内部分发

---

## ⚠️ 常见问题

### Android 构建错误

**问题**: Gradle 构建失败
```bash
# 解决方案：
# 1. 清除 Gradle 缓存
cd android && ./gradlew clean

# 2. 重新构建
./gradlew assembleRelease
```

**问题**: APK 安装失败
```
原因：签名证书配置不正确
解决方案：使用 EAS Build 自动处理签名
```

### iOS 构建错误

**问题**: 证书配置失败
```
原因：Apple Developer 账户未配置或有误
解决方案：
1. 检查 Apple Developer 账户状态
2. 登陆 Xcode 查看证书配置
3. 使用 EAS Build 处理证书
```

**问题**: 版本号不匹配
```
原因：app.json 和 package.json 版本号不一致
解决方案：确保两者都是 2.1.0
```

---

## 🎯 快速开始命令

```bash
# 1. 完整测试（使用 Expo Go）
npx expo start --clear

# 2. Android 构建（EAS）
eas build --platform android --profile production

# 3. iOS 构建（EAS）
eas build --platform ios --profile production

# 4. 查看 EAS 构建状态
eas build:list

# 5. 下载构建产物
eas build:view [BUILD_ID]
```

---

## 📞 构建支持

如果遇到构建问题，可以：

1. **查看 EAS 构建日志**:
   ```bash
   eas build:list
   ```

2. **查看详细日志**:
   ```bash
   eas build:view [BUILD_ID] --platform android/ios
   ```

3. **重新构建**:
   ```bash
   eas build --platform android --profile production --non-interactive
   ```

---

## ✅ 就绪检查

在开始构建前，确认：

- [ ] 所有功能已测试完成
- [ ] GitHub 代码已推送成功（commit 461631d）
- [ ] 版本号已更新为 2.1.0
- [ ] 账户配置正常（EAS/开发者账户）
- [ ] 构建环境已准备好（或已配置 EAS）

---

## 📌 下一步

1. **选择构建方式**：
   - 有环境：本地构建（Android Studio / Xcode）
   - 无环境：EAS Build（推荐）

2. **执行构建命令**：
   - Android: `eas build --platform android --profile production`
   - iOS: `eas build --platform ios --profile production`

3. **测试构建产物**：
   - 下载 APK/IPA 文件
   - 安装到测试设备
   - 验证所有功能

4. **发布到测试用户**：
   - 使用 TestFlight（iOS）
   - 使用企业签名/IPA 分发
   - 使用第三方分发平台

🎉 **准备就绪，可以开始构建！**