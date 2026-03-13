# 🚀 Android APK 构建指南（使用 EAS Build）

## 📋 前置条件

### 1. 登录 Expo 账户

**如果还没有 Expo 账户，需要先创建**

```bash
# 打开终端，执行：
eas login -u YOUR_EMAIL_ADDRESS
```

**示例**:
```bash
eas login -u your.email@example.com
```

然后按提示输入密码或验证码。

### 2. 验证登录

```bash
# 查看当前登录状态
eas whoami
```

应该显示你的 Expo 账户信息。

---

## 🔨 构建步骤

### Step 1: 启动 EAS Build

```bash
# 在项目目录执行：
cd C:\Users\WilliamJohnWalker\inventory-app

# 开始构建 Android APK
eas build --platform android --profile production
```

**输出示例**:
```
› Viewing build queue: will continue building in the background
› Build Queue
  Build ID: e1e5f7a3-94c2-4ef1-9f83-33df3f2d4e71
  Project: your-project-id
  Platform: android
  Profile: production
```

**记住这个 Build ID**（例如：`e1e5f7a3-94c2-4ef1-9f83-33df3f2d4e71`）

### Step 2: 查看构建状态

```bash
# 查看所有构建
eas build:list

# 查看特定构建的日志
eas build:view [BUILD_ID]
```

**示例**:
```bash
# 查看最新构建
eas build:view e1e5f7a3-94c2-4ef1-9f83-33df3f2d4e71
```

### Step 3: 完成后下载 APK

#### 方法 A: 使用 EAS CLI 下载

```bash
# 下载 APK（需要先完成构建）
eas build:view [BUILD_ID]
```

然后按照提示下载文件。

#### 方法 B: 使用浏览器下载

```bash
# 构建完成后，使用此命令查看详情
eas build:view [BUILD_ID]
```

这会打开浏览器，你可以在浏览器中下载 APK。

---

## ⏱️ 构建时间预估

- **Android APK**: 15-20 分钟
- **iOS IPA**: 20-30 分钟（如果后续需要）

---

## 📊 构建状态监控

### 查看实时日志

```bash
# 使用构建 ID 查看日志
eas build:view [BUILD_ID]
```

**预期进度**（示例）：
```
› 1/10: Loading workflow details...
› 2/10: Building native project...
› 3/10: Signing APK...
› 4/10: Uploading artifacts...
```

---

## 📁 下载完成后

### 文件位置

构建完成的 APK 文件需要手动下载：

1. **使用 EAS CLI**:
   ```bash
   eas build:view [BUILD_ID]
   ```

2. **使用浏览器**:
   - 访问: https://expo.dev
   - 登录你的 Expo 账户
   - 进入 "Builds" 页面
   - 找到你的构建记录
   - 下载 APK 文件

### 文件命名建议

下载后重命名为:
```
production-2.1.0.apk
```

---

## 🧪 安装测试

### Android 设备安装

```bash
# 如果已连接 Android 设备
adb install production-2.1.0.apk

# 或者直接在设备上安装
# 文件共享 → 安装 APK
```

### 测试清单

#### 基础功能

- [ ] 应用可正常安装
- [ ] 应用启动无崩溃
- [ ] 管理员登录功能正常
- [ ] 分销商登录功能正常

#### v2.1.0 UI/UX 优化

- [ ] 统计卡片可折叠/展开
- [ ] Filter Chips 触觉反馈
- [ ] Toast 消息弹跳动画
- [ ] 不健康商品视觉警告
- [ ] 按钮按压动画反馈

#### 完整功能测试

- [ ] 商品管理（添加/编辑/删除）
- [ ] 入库功能正常
- [ ] 出库功能正常
- [ ] 订单创建正常（数量5倍数验证）
- [ ] 订单管理（接单/删除/Excel导出）
- [ ] 报表查看正常
- [ ] 离线模式正常

---

## 🆘 如果登录失败

### 常见问题

**问题**: `An Expo user account is required`

**解决方案**:
```bash
# 方法 1: 使用替代登录方式
eas login
# 然后按提示输入邮箱和密码

# 方法 2: 使用 GitHub 账号登录
eas login --github
```

**问题**: `Error: build command failed`

**解决方案**:
```bash
# 检查是否已登录
eas whoami

# 如果未登录，先重新登录
eas login
```

---

## 🚀 完整执行指南

### 终端命令执行顺序

```bash
# 1. 进入项目目录
cd C:\Users\WilliamJohnWalker\inventory-app

# 2. 登录 Expo 账户
eas login

# 3. 验证登录
eas whoami

# 4. 开始构建
eas build --platform android --profile production

# 5. 记录返回的 Build ID

# 6. 监控构建进度
eas build:view [BUILD_ID]

# 7. 等待 15-20 分钟完成构建

# 8. 下载 APK
eas build:view [BUILD_ID]

# 9. 测试安装
adb install production-2.1.0.apk
```

---

## 📱 构建完成后的分发

### 分发方式

1. **邮件发送附件**
   - 将 APK 文件作为邮件附件发送
   - 使用 Outlook / Gmail 等

2. **网盘共享**
   - 百度网盘 / 阿里云盘
   - 生成分享链接给测试用户

3. **第三方分发平台**
   - 蒲公英
   - fir.im
   - 企业内部分发系统

---

## ⚠️ 注意事项

### 版本号一致性

确保以下文件中的版本号都是 `2.1.0`:
- `package.json`
- `app.json`
- Git commit 标签（可选）

### 网络要求

- EAS Build 需要稳定的互联网连接
- 构建期间请勿关闭终端
- 如需中断，可按 Ctrl+C

### 缓存清理

如果遇到问题，尝试清理缓存：

```bash
# 清除 Expo 缓存
npx expo start --clear

# 清除 Node 缓存
npm cache clean --force

# 重新开始构建
eas build --platform android --profile production
```

---

## 🎯 下一步

### 完成清单

- [ ] EAS CLI 已安装
- [ ] Expo 账户已登录 (eas whoami 验证)
- [ ] 构建命令已执行
- [ ] Build ID 已记录（例如：e1e5f7a3-94c2-4ef1-9f83-33df3f2d4e71）
- [ ] 构建完成 (等待 15-20 分钟)
- [ ] APK 已下载并重命名为 production-2.1.0.apk
- [ ] APK 已安装到测试设备
- [ ] 应用功能测试完成

### 立即开始

```bash
# 1. 打开终端，进入项目
cd C:\Users\WilliamJohnWalker\inventory-app

# 2. 运行构建命令
eas build --platform android --profile production

# 3. 记录 Build ID（会显示在输出中）

# 4. 等待完成（15-20 分钟）

# 5. 下载并测试
```

---

## 📞 如需帮助

如果遇到任何问题，可以告诉我具体的错误信息，我会帮你解决。

已为你准备好的：
- ✅ Git 代码已提交（commit 461631d）
- ✅ 版本已 bump（v2.1.0）
- ✅ EAS 配置已创建（eas.json）
- ✅ TypeScript 编译通过

**现在登录 Expo 账户并开始构建吧！**
