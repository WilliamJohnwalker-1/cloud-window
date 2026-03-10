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

1. `app.json` 保持 `updates.url` 和 `runtimeVersion.policy=appVersion`。
2. 每次发新 APK 时迭代移动端版本号（如 `2.1.4 -> 2.1.5`）。
3. 日常前端迭代通过 `eas update` 发布到对应 channel。
4. 应用内提供“检查更新”入口，用户可主动触发下载并重启。

## 发布建议流程

### A. 仅前端改动（OTA）

```bash
eas update --channel production --message "mobile ota: xxx"
```

### B. 含原生改动（新 APK）

```bash
eas build --platform android --profile production
```

> 构建完成后把 APK 链接发给测试或运营，再配合后续 OTA 迭代。

## 自检清单

- [ ] `expo-updates` 已安装并可用
- [ ] Profile 页面可手动检查更新
- [ ] 启动后可自动检查更新（非开发环境）
- [ ] README 与 AGENTS 文档已同步 OTA 规则
