# 移动端应用内更新（OTA）能力清单

## 一句话结论

安装一次包含 `expo-updates` 配置的新 APK 后，后续大多数前端改动可在应用内更新；涉及原生层改动仍需重新发 APK。

## 可以通过 OTA 下发的改动

- React/TypeScript 业务逻辑修改
- 页面 UI/样式调整
- 文案与配置常量（不涉及原生能力）
- Zustand store 流程与校验逻辑
- 非原生依赖的纯 JS 工具函数

## 不能通过 OTA 下发的改动（必须发新 APK）

- 新增/升级原生模块（需原生编译）
- AndroidManifest / iOS Info.plist 权限与能力修改
- 原生 SDK 接入变更（支付、推送、地图原生层等）
- Expo 插件配置导致原生工程变更
- 应用包名、签名、图标等原生构建信息变化

## 项目落地规范

1. `app.json` 保持 `updates.url`，并使用 `runtimeVersion.policy=appVersion`（版本升级即切换 runtime）。
2. 日常前端迭代通过 `eas update --environment production --channel production` 发布。
3. 发布 OTA 前先执行 `npm run ota:check-native`，若检测到原生敏感改动则必须先发新 APK/IPA。
4. 应用内“检查更新”先查 OTA；若无 OTA 再读取二进制更新清单（manifest）并提示下载最新 APK。

## 二进制更新清单（manifest）约定

在 `app.json -> expo.extra.binaryUpdate.manifestUrl` 配置一个可公网访问 JSON（推荐指向 Cloudflare Worker 的 `/mobile/latest.json`），例如：

```json
{
  "latestVersion": "2.1.6",
  "androidApkUrl": "https://your-cdn.example.com/inventory-app-2.1.6.apk"
}
```

- `latestVersion`：与 `app.json` 的 `expo.version` 对齐
- `androidApkUrl`：EAS 构建产物（或你自己的分发 CDN）下载地址
- 每次发新版 APK 后，更新该 JSON 即可让旧版客户端在“检查更新”中自动跳转下载

若使用 Worker 动态返回，更新流程只需改 Worker 变量：

- `MOBILE_LATEST_VERSION`
- `MOBILE_ANDROID_APK_URL`

补充：若未显式设置 `manifestUrl`，移动端会自动尝试 `EXPO_PUBLIC_PAYMENT_API_URL + /mobile/latest.json`。

如果不使用 manifest，也可在 `app.json -> expo.extra.binaryUpdate` 里直接配置：

- `androidApkUrl`
- `androidApkVersion`

但推荐 manifest 方式，便于在不重新发包的情况下动态调整下载地址。

## 发布建议流程

### A. 仅前端改动（OTA）

```bash
npm run ota:check-native
eas update --environment production --channel production --message "mobile ota: xxx"
```

### B. 含原生改动（新 APK）

```bash
eas build --platform android --profile production
```

> 构建完成后把 APK 链接发给测试或运营，再配合后续 OTA 迭代。

构建完成后同步更新 manifest（`latestVersion + androidApkUrl`）。

## 自检清单

- [ ] `expo-updates` 已安装并可用
- [ ] Profile 页面可手动检查更新
- [ ] 启动后可自动检查更新（非开发环境）
- [ ] README 与 AGENTS 文档已同步 OTA 规则
