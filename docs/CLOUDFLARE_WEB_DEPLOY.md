# Cloudflare 部署指南（Web + 收款 Worker）

## 1) 本地构建 Web

```bash
npm run web:build
```

构建输出目录为 `dist/`。

---

## 2) 部署前环境变量

在 Cloudflare Pages（前端）里配置（如当前 Web 站点接入支付时）：

- `VITE_PAYMENT_API_URL`：支付 Worker 地址（本项目建议 `https://pay.yunchuang888888.com`）
- `VITE_PAYMENT_MOCK`：`true`（联调）/`false`（生产）

> 说明：当前仓库的支付调用主链路仍在移动端（`src/lib/payment.ts`），Pages 若未接入支付页面，这两个变量不会影响 Worker 实际收款。

移动端实测请同时确保 `.env`：

- `EXPO_PUBLIC_PAYMENT_API_URL=https://pay.yunchuang888888.com`
- `EXPO_PUBLIC_PAYMENT_MOCK=false`

在 Cloudflare Worker（后端）里配置：

- `PAYMENT_MOCK=true`（联调）
- 生产时改为 `PAYMENT_MOCK=false`，并配置：
  - 微信：`WECHAT_MCH_ID`, `WECHAT_APP_ID`, `WECHAT_API_V3_KEY`, `WECHAT_SERIAL_NO`, `WECHAT_PRIVATE_KEY`
  - 支付宝：`ALIPAY_APP_ID`, `ALIPAY_PRIVATE_KEY`, `ALIPAY_PUBLIC_KEY`, `ALIPAY_GATEWAY`, `ALIPAY_NOTIFY_URL`
  - 移动端安装包更新清单：
    - `MOBILE_LATEST_VERSION`（例如 `2.1.6`）
    - `MOBILE_ANDROID_APK_URL`（建议固定为 `https://yunchuang888888.com/mobile/download/latest.apk`）

可先检查配置完整性：

```bash
curl https://pay.yunchuang888888.com/api/payment/config-check

# 建议回调地址（支付宝）
# ALIPAY_NOTIFY_URL=https://pay.yunchuang888888.com/api/payment/alipay/notify
```

---

## 3) 部署 Worker

```bash
npm run cf:deploy
```

> 若 Cloudflare 控制台要求 Version command 非空，可填 `npm run cf:version`（等同安全部署，含 `--keep-vars`）。
>
> 请勿将 Deploy command 设置为 `npm run cf:version:upload`。`wrangler versions upload` 不支持 `--keep-vars`，会覆盖 Dashboard Text 变量（Secrets 通常仍保留）。

（使用 `wrangler.toml`）

健康检查：

```bash
curl https://pay.yunchuang888888.com/health
```

移动端更新清单检查：

```bash
curl https://yunchuang888888.com/mobile/latest.json
```

期望返回：

```json
{
  "ok": true,
  "configured": true,
  "latestVersion": "2.1.6",
  "androidApkUrl": "https://your-cdn.example.com/inventory-app-2.1.6.apk",
  "updatedAt": "2026-03-10T12:34:56.000Z"
}
```

---

## 4) 部署 Pages

```bash
npm run build --prefix web
```

> 若你的控制台/流程不允许该变量留空，请直接将 `MOBILE_ANDROID_APK_URL` 设为：
>
> `https://yunchuang888888.com/mobile/download/latest.apk`
>
> 并保持 `MOBILE_ANDROID_APK_KEY` 为当前版本 APK 对象键（如 `inventory-app-2.1.6.apk`）。

（脚本内使用 `--project-name inventory-web`）

或者在 Cloudflare Pages 控制台设置：

- Build command: `npm run web:build`
- Output directory: `dist`

`public/_redirects` 已配置 SPA 路由回落，`public/_headers` 已配置缓存策略。

---

## 4.1) Cloudflare 控制台一次性配置（支付子域 + 下载主域）

### A. Worker 路由（解决 workers.dev 443 可达性）

Cloudflare Dashboard -> Workers & Pages -> `cloud-window` -> Settings -> Domains & Routes：

添加以下 Route（推荐）：

- `pay.yunchuang888888.com/api/*`
- `pay.yunchuang888888.com/health`
- `yunchuang888888.com/mobile/*`

> 若你希望全部都放在支付子域，也可改成 `pay.yunchuang888888.com/mobile/*`，并同步改 `MOBILE_ANDROID_APK_URL`。

### B. DNS/SSL

Cloudflare Dashboard -> DNS：

- 确保 `yunchuang888888.com` 记录为 **Proxied（橙云）**。

Cloudflare Dashboard -> SSL/TLS：

- 模式建议 `Full` 或 `Full (strict)`。

### C. Builds（避免覆盖 Dashboard Text Variables）

Cloudflare Dashboard -> Worker -> Settings -> Builds：

- Build command: `None`
- Deploy command: `npm run cf:deploy`
- Version command: `npm run cf:version`

不要使用：`npm run cf:version:upload`

### D. 支付与 APK 下载连通验证

```bash
curl -I https://pay.yunchuang888888.com/health
curl https://pay.yunchuang888888.com/api/payment/config-check
curl https://yunchuang888888.com/mobile/latest.json
curl -I https://yunchuang888888.com/mobile/download/latest.apk
```

---

## 5) 微信 / 支付宝正式接入要点（官方约束）

### 微信 Native 支付（API v3）

- 下单接口：`POST /v3/pay/transactions/native`
- 必填：`appid`, `mchid`, `description`, `out_trade_no`, `notify_url`, `amount.total(分)`
- 请求签名：`WECHATPAY2-SHA256-RSA2048`（商户私钥）
- 回调验签：使用微信平台公钥验证 `Wechatpay-*` 头签名
- 回调报文解密：`AES-256-GCM` + APIv3 Key

### 支付宝当面付（付款码条码支付）

- 收款接口：`alipay.trade.pay`（`scene=bar_code`）
- 必填：`out_trade_no`, `total_amount(元)`, `subject`, `auth_code`
- 请求签名：`RSA2`（应用私钥）
- 回调验签：用支付宝公钥验签
- 回调落账前必须校验：`app_id`、`out_trade_no`、`total_amount`、`trade_status=TRADE_SUCCESS`

---

## 6) 当前代码状态

- 前端已支持：订单购物车支持扫码商品条码入车，按零售价计算后扫码买家付款码执行支付宝收款
- Worker 已支持 mock + 支付宝条码支付主流程；微信仍为占位待接入
