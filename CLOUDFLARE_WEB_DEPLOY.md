# Cloudflare 部署指南（Web + 收款 Worker）

## 1) 本地构建 Web

```bash
npm run web:build
```

构建输出目录为 `dist/`。

---

## 2) 部署前环境变量

在 Cloudflare Pages（前端）里配置：

- `EXPO_PUBLIC_PAYMENT_API_URL`：Worker 地址（如 `https://inventory-payment.xxx.workers.dev`）
- `EXPO_PUBLIC_PAYMENT_MOCK`：`true`（联调）/`false`（生产）

在 Cloudflare Worker（后端）里配置：

- `PAYMENT_MOCK=true`（联调）
- 生产时改为 `PAYMENT_MOCK=false`，并配置：
  - 微信：`WECHAT_MCH_ID`, `WECHAT_APP_ID`, `WECHAT_API_V3_KEY`, `WECHAT_SERIAL_NO`, `WECHAT_PRIVATE_KEY`
  - 支付宝：`ALIPAY_APP_ID`, `ALIPAY_PRIVATE_KEY`, `ALIPAY_PUBLIC_KEY`

---

## 3) 部署 Worker

```bash
npm run deploy:worker
```

（使用 `wrangler.toml`）

健康检查：

```bash
curl https://<your-worker-domain>/health
```

---

## 4) 部署 Pages

```bash
npm run deploy:cloudflare
```

（脚本内使用 `--project-name inventory-web`）

或者在 Cloudflare Pages 控制台设置：

- Build command: `npm run web:build`
- Output directory: `dist`

`public/_redirects` 已配置 SPA 路由回落，`public/_headers` 已配置缓存策略。

---

## 5) 微信 / 支付宝正式接入要点（官方约束）

### 微信 Native 支付（API v3）

- 下单接口：`POST /v3/pay/transactions/native`
- 必填：`appid`, `mchid`, `description`, `out_trade_no`, `notify_url`, `amount.total(分)`
- 请求签名：`WECHATPAY2-SHA256-RSA2048`（商户私钥）
- 回调验签：使用微信平台公钥验证 `Wechatpay-*` 头签名
- 回调报文解密：`AES-256-GCM` + APIv3 Key

### 支付宝当面付扫码

- 下单接口：`alipay.trade.precreate`
- 必填：`out_trade_no`, `total_amount(元)`, `subject`, `notify_url`
- 请求签名：`RSA2`（应用私钥）
- 回调验签：用支付宝公钥验签
- 回调落账前必须校验：`app_id`、`out_trade_no`、`total_amount`、`trade_status=TRADE_SUCCESS`

---

## 6) 当前代码状态

- 前端已支持：出库 -> 选择微信/支付宝 -> 生成收款码 -> 轮询确认 -> 成功后执行出库扣减
- Worker 已支持 mock 全链路；真实支付签名逻辑保留为生产接入位
