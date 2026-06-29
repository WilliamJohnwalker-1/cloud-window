/* global Response, URL, TextEncoder, TextDecoder, atob, btoa, crypto, fetch, URLSearchParams */

/**
 * Cloudflare Worker payment API (skeleton with mock mode).
 *
 * Production path:
 * 1) Keep provider call sections aligned with official WeChat/Alipay signing logic.
 * 2) Bind D1 as PAYMENT_DB and persist payment states.
 */

const mockStore = new Map();

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function normalizePem(pem) {
  return String(pem || '').replace(/\\n/g, '\n').trim();
}

function base64ToBytes(base64) {
  const raw = atob(String(base64 || ''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function normalizeWechatSerial(input) {
  return String(input || '')
    .replace(/[\r\n\s:]/g, '')
    .trim()
    .toUpperCase();
}

function pemToArrayBuffer(pem) {
  const lines = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(lines);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function buildAlipayRequestSignContent(params) {
  const keys = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort();
  return keys.map((key) => `${key}=${params[key]}`).join('&');
}

function buildAlipayVerifySignContent(params) {
  const keys = Object.keys(params)
    .filter((key) => key !== 'sign' && key !== 'sign_type' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort();
  return keys.map((key) => `${key}=${params[key]}`).join('&');
}

async function rsa2Sign(content, privateKeyPem) {
  const keyData = pemToArrayBuffer(normalizePem(privateKeyPem));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, textEncoder.encode(content));
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toAlipayTimestamp(date = new Date()) {
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function createWechatNonce(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((value) => chars[value % chars.length]).join('');
}

function parseWechatTradeStatus(tradeState) {
  const value = String(tradeState || '').toUpperCase();
  if (value === 'SUCCESS') return 'paid';
  if (value === 'USERPAYING' || value === 'NOTPAY' || value === 'ACCEPTED') return 'pending';
  if (value === 'CLOSED') return 'timeout';
  if (value === 'REVOKED' || value === 'PAYERROR') return 'failed';
  return 'failed';
}

function mapWechatErrorCodeToStatus(code) {
  const value = String(code || '').toUpperCase();
  if (value === 'USERPAYING') return 'pending';
  if (value === 'ORDERPAID') return 'paid';
  if (value === 'SYSTEMERROR' || value === 'BANKERROR') return 'pending';
  if (value === 'ORDERCLOSED') return 'timeout';
  return 'failed';
}

async function readJsonSafely(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  const text = await response.text();
  return { raw: text };
}

async function postWechatRequest(env, method, pathWithQuery, payload = null) {
  const mchId = String(env.WECHAT_MCH_ID || '').replace(/[\r\n]/g, '').trim();
  const serialNo = normalizeWechatSerial(env.WECHAT_SERIAL_NO);
  const privateKey = env.WECHAT_PRIVATE_KEY;
  const gateway = String(env.WECHAT_GATEWAY || 'https://api.mch.weixin.qq.com').trim().replace(/\/$/, '');

  if (!mchId || !serialNo || !privateKey) {
    return { ok: false, status: 'failed', error: '微信配置不完整（缺少 WECHAT_MCH_ID/WECHAT_SERIAL_NO/WECHAT_PRIVATE_KEY）' };
  }

  const body = payload === null ? '' : JSON.stringify(payload);
  const nonce = createWechatNonce();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signMessage = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = await rsa2Sign(signMessage, privateKey);
  const safeMchId = mchId.replace(/"/g, '');
  const safeSerialNo = serialNo.replace(/"/g, '');
  const safeSignature = String(signature || '').replace(/[\r\n"]/g, '');
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${safeMchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${safeSerialNo}",signature="${safeSignature}"`;

  const response = await fetch(`${gateway}${pathWithQuery}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
      'User-Agent': 'cloud-window-worker/1.0',
      ...(payload === null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === null ? {} : { body }),
  });

  const data = await readJsonSafely(response);
  if (response.ok) {
    return { ok: true, status: parseWechatTradeStatus(data.trade_state), data };
  }

  const errorCode = String(data.code || '').trim();
  const errorMessage = String(data.message || data.raw || `微信请求失败（HTTP ${response.status}）`).trim();
  const requestId = String(response.headers.get('Request-ID') || response.headers.get('request-id') || '').trim();
  return {
    ok: false,
    status: mapWechatErrorCodeToStatus(errorCode),
    code: errorCode,
    error: errorMessage,
    requestId,
    data,
    httpStatus: response.status,
  };
}

async function postAlipayRequest(env, method, bizContent) {
  const appId = env.ALIPAY_APP_ID;
  const privateKey = env.ALIPAY_PRIVATE_KEY;
  const gateway = env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';

  if (!appId || !privateKey) {
    return { ok: false, status: 'failed', error: '支付宝配置不完整（缺少 ALIPAY_APP_ID/ALIPAY_PRIVATE_KEY）' };
  }

  const requestParams = {
    app_id: appId,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: toAlipayTimestamp(),
    version: '1.0',
    notify_url: env.ALIPAY_NOTIFY_URL || undefined,
    biz_content: JSON.stringify(bizContent),
  };

  const signContent = buildAlipayRequestSignContent(requestParams);
  const sign = await rsa2Sign(signContent, privateKey);

  const form = new URLSearchParams({ ...requestParams, sign });
  const response = await fetch(gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: form,
  });

  const payload = await response.json();
  const responseKey = method.replace(/\./g, '_') + '_response';
  const methodPayload = payload[responseKey];

  if (!methodPayload) {
    return { ok: false, status: 'failed', error: '支付宝响应格式异常', raw: payload };
  }

  if (methodPayload.code === '10000') {
    return { ok: true, status: parseTradeStatus(methodPayload.trade_status), data: methodPayload };
  }
  if (methodPayload.code === '10003') {
    return { ok: true, status: 'pending', data: methodPayload };
  }

  return {
    ok: false,
    status: 'failed',
    error: methodPayload.sub_msg || methodPayload.msg || '支付宝请求失败',
    code: methodPayload.code,
    signContent,
    raw: payload,
  };
}

async function postAlipayRefundRequest(env, bizContent) {
  const appId = env.ALIPAY_APP_ID;
  const privateKey = env.ALIPAY_PRIVATE_KEY;
  const gateway = env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';

  if (!appId || !privateKey) {
    return { ok: false, status: 'failed', error: '支付宝配置不完整（缺少 ALIPAY_APP_ID/ALIPAY_PRIVATE_KEY）' };
  }

  const method = 'alipay.trade.refund';
  const requestParams = {
    app_id: appId,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: toAlipayTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify(bizContent),
  };

  const signContent = buildAlipayRequestSignContent(requestParams);
  const sign = await rsa2Sign(signContent, privateKey);

  const form = new URLSearchParams({ ...requestParams, sign });
  const response = await fetch(gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: form,
  });

  const payload = await response.json();
  const methodPayload = payload.alipay_trade_refund_response;

  if (!methodPayload) {
    return { ok: false, status: 'failed', error: '支付宝退款响应格式异常', raw: payload };
  }

  if (methodPayload.code === '10000') {
    const status = String(methodPayload.fund_change || '').toUpperCase() === 'Y' ? 'refunded' : 'refund_pending';
    return { ok: true, status, data: methodPayload };
  }

  return {
    ok: false,
    status: 'failed',
    error: methodPayload.sub_msg || methodPayload.msg || '支付宝退款请求失败',
    code: methodPayload.code,
    signContent,
    raw: payload,
  };
}

function parseTradeStatus(tradeStatus) {
  if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') return 'paid';
  if (tradeStatus === 'WAIT_BUYER_PAY') return 'pending';
  if (tradeStatus === 'TRADE_CLOSED') return 'timeout';
  return 'failed';
}

function almostEqualAmount(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) < 0.01;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function publicKeyPemToArrayBuffer(pem) {
  const lines = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(lines);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function rsa2Verify(content, signBase64, publicKeyPem) {
  const keyData = publicKeyPemToArrayBuffer(normalizePem(publicKeyPem));
  const cryptoKey = await crypto.subtle.importKey(
    'spki',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const raw = atob(String(signBase64 || ''));
  const signature = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    signature[i] = raw.charCodeAt(i);
  }

  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, textEncoder.encode(content));
}

async function verifyWechatNotifySignature({ timestamp, nonce, bodyText, signature, publicKeyPem }) {
  const keyData = publicKeyPemToArrayBuffer(normalizePem(publicKeyPem));
  const cryptoKey = await crypto.subtle.importKey(
    'spki',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signMessage = `${timestamp}\n${nonce}\n${bodyText}\n`;
  const signatureBytes = base64ToBytes(signature);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signatureBytes, textEncoder.encode(signMessage));
}

async function decryptWechatNotifyResource(resource, apiV3Key) {
  const nonce = String(resource?.nonce || '');
  const ciphertext = String(resource?.ciphertext || '');
  const associatedData = String(resource?.associated_data || '');
  if (!nonce || !ciphertext) {
    throw new Error('微信回调资源缺少 nonce/ciphertext');
  }

  const keyBytes = textEncoder.encode(String(apiV3Key || '').trim());
  if (keyBytes.byteLength !== 32) {
    throw new Error('WECHAT_API_V3_KEY 必须为 32 字节');
  }

  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: textEncoder.encode(nonce),
      additionalData: textEncoder.encode(associatedData),
      tagLength: 128,
    },
    cryptoKey,
    base64ToBytes(ciphertext),
  );

  const plainText = textDecoder.decode(plainBuffer);
  return JSON.parse(plainText);
}

function buildPaymentEventKey({ channel, eventType, outTradeNo, notifyId, tradeNo }) {
  return [channel, eventType, outTradeNo || '-', notifyId || '-', tradeNo || '-'].join(':');
}

function toWechatOutTradeNo(orderId) {
  return String(orderId || '').replace(/-/g, '').trim();
}

function maybeUuidFromOutTradeNo(outTradeNo) {
  const normalized = String(outTradeNo || '').trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(normalized)) {
    return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
  }
  return normalized;
}

function buildRefundedItemsSnapshot(selectedItems) {
  return selectedItems.map((item) => ({
    order_item_id: String(item.id || ''),
    product_id: String(item.product_id || ''),
    product_name: String(item?.products?.name || ''),
    quantity: Number(item.quantity || 0),
    retail_price: Number(item.retail_price || 0),
    discount_price: Number(item.discount_price || 0),
  }));
}

const wechatAuthCodePattern = /^1[0-5][0-9]{16}$/;
const alipayAuthCodePattern = /^(?:2[5-9]|30)[0-9]{14,22}$/;

function getMissingEnv(env, keys) {
  return keys.filter((key) => {
    const value = env[key];
    return value === undefined || value === null || String(value).trim() === '';
  });
}

async function supabaseRequest(env, path, init = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in worker env');
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function getOrderById(env, orderId) {
  const rows = await supabaseRequest(
    env,
    `/orders?id=eq.${encodeURIComponent(orderId)}&select=id,distributor_id,store_id,order_kind,total_retail_amount,payment_amount,payment_status,payment_method,payment_transaction_id,payment_paid_at`,
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function getOrderWithItems(env, orderId) {
  const orderRows = await supabaseRequest(
    env,
    `/orders?id=eq.${encodeURIComponent(orderId)}&select=id,distributor_id,request_id,store_id,order_kind,total_retail_amount,total_discount_amount,payment_amount,payment_status,payment_method,payment_transaction_id`,
  );

  if (!Array.isArray(orderRows) || orderRows.length === 0) return null;

  const itemRows = await supabaseRequest(
    env,
    `/order_items?order_id=eq.${encodeURIComponent(orderId)}&select=id,product_id,quantity,retail_price,discount_price,products(name)`,
  );

  return {
    ...orderRows[0],
    items: Array.isArray(itemRows) ? itemRows : [],
  };
}

async function resolveRefundApproverUserId(env, order) {
  if (order?.store_id) {
    const storeRows = await supabaseRequest(
      env,
      `/stores?id=eq.${encodeURIComponent(String(order.store_id))}&select=distributor_id&limit=1`,
    );
    const storeApproverId = Array.isArray(storeRows) && storeRows.length > 0
      ? String(storeRows[0]?.distributor_id || '').trim()
      : '';
    if (storeApproverId) return storeApproverId;
  }

  return String(order?.distributor_id || '').trim();
}

async function insertNotification(env, { userId, type, orderId, message }) {
  if (!userId) return;
  await supabaseRequest(env, '/notifications', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      type,
      order_id: orderId || null,
      message: String(message || '').trim() || '系统通知',
    }),
  });
}

async function getRefundRequestById(env, requestId) {
  const rows = await supabaseRequest(
    env,
    `/refund_requests?id=eq.${encodeURIComponent(requestId)}&select=*`,
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function patchOrderPayment(env, orderId, patch) {
  await supabaseRequest(env, `/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

async function increaseInventoryByProduct(env, productId, deltaQuantity) {
  const rows = await supabaseRequest(
    env,
    `/inventory?product_id=eq.${encodeURIComponent(productId)}&select=product_id,quantity&limit=1`,
  );
  if (!Array.isArray(rows) || rows.length === 0) return;
  const currentQuantity = Number(rows[0]?.quantity || 0);
  await supabaseRequest(env, `/inventory?product_id=eq.${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      quantity: currentQuantity + Number(deltaQuantity || 0),
      updated_at: new Date().toISOString(),
    }),
  });
}

async function applyRetailRefundItemsFallback(env, order, refundItemIds, operatorUserId = null) {
  const orderId = String(order?.id || '').trim();
  if (!orderId) throw new Error('fallback missing order id');

  try {
    const rpcResult = await supabaseRequest(env, '/rpc/apply_retail_refund_items_atomic', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        p_order_id: orderId,
        p_order_item_ids: refundItemIds,
        p_operator_id: operatorUserId || order?.distributor_id || null,
      }),
    });

    if (rpcResult && typeof rpcResult === 'object' && !Array.isArray(rpcResult)) {
      return rpcResult;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    const missingRpc = message.includes('apply_retail_refund_items_atomic')
      || message.includes('PGRST202')
      || message.toLowerCase().includes('could not find the function');

    if (!missingRpc) {
      throw error;
    }
  }

  const orderItems = Array.isArray(order?.items) ? order.items : [];
  const targetItems = orderItems.filter((item) => refundItemIds.includes(String(item.id || '')));
  if (targetItems.length === 0) throw new Error('fallback no valid refund items');

  const restoreByProduct = new Map();
  targetItems.forEach((item) => {
    const productId = String(item.product_id || '').trim();
    if (!productId) return;
    const quantity = Number(item.quantity || 0);
    restoreByProduct.set(productId, Number(restoreByProduct.get(productId) || 0) + quantity);
  });

  for (const [productId, quantity] of restoreByProduct.entries()) {
    await increaseInventoryByProduct(env, productId, quantity);
  }

  const encodedIds = refundItemIds.map((id) => encodeURIComponent(id)).join(',');
  await supabaseRequest(env, `/order_items?id=in.(${encodedIds})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      quantity: 0,
    }),
  });

  const remainingItems = await supabaseRequest(
    env,
    `/order_items?order_id=eq.${encodeURIComponent(orderId)}&quantity=gt.0&select=id,quantity,retail_price,discount_price`,
  );
  const safeRemaining = Array.isArray(remainingItems) ? remainingItems : [];

  if (safeRemaining.length === 0) {
    await supabaseRequest(env, `/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        total_retail_amount: 0,
        total_discount_amount: 0,
        payment_amount: 0,
        payment_status: 'refunded',
      }),
    });
    return { order_deleted: false, remaining_discount_amount: 0, payment_status: 'refunded' };
  }

  const remainingRetailAmount = Number(
    safeRemaining
      .reduce((sum, item) => sum + Number(item.retail_price || 0) * Number(item.quantity || 0), 0)
      .toFixed(2),
  );
  const remainingDiscountAmount = Number(
    safeRemaining
      .reduce((sum, item) => sum + Number(item.discount_price || 0) * Number(item.quantity || 0), 0)
      .toFixed(2),
  );

  await supabaseRequest(env, `/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      total_retail_amount: remainingRetailAmount,
      total_discount_amount: remainingDiscountAmount,
      payment_amount: remainingRetailAmount,
      payment_status: 'partial_refunded',
    }),
  });

  return {
    order_deleted: false,
    remaining_discount_amount: remainingDiscountAmount,
    payment_status: 'partial_refunded',
  };
}

async function syncRetailRefundOrderState(env, orderId) {
  const remainingItems = await supabaseRequest(
    env,
    `/order_items?order_id=eq.${encodeURIComponent(orderId)}&quantity=gt.0&select=id,quantity,retail_price,discount_price`,
  );
  const safeRemaining = Array.isArray(remainingItems) ? remainingItems : [];

  if (safeRemaining.length === 0) {
    await supabaseRequest(env, `/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        total_retail_amount: 0,
        total_discount_amount: 0,
        payment_amount: 0,
        payment_status: 'refunded',
      }),
    });
    return { payment_status: 'refunded', remaining_discount_amount: 0 };
  }

  const remainingRetailAmount = Number(
    safeRemaining
      .reduce((sum, item) => sum + Number(item.retail_price || 0) * Number(item.quantity || 0), 0)
      .toFixed(2),
  );
  const remainingDiscountAmount = Number(
    safeRemaining
      .reduce((sum, item) => sum + Number(item.discount_price || 0) * Number(item.quantity || 0), 0)
      .toFixed(2),
  );

  await supabaseRequest(env, `/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      total_retail_amount: remainingRetailAmount,
      total_discount_amount: remainingDiscountAmount,
      payment_amount: remainingRetailAmount,
      payment_status: 'partial_refunded',
    }),
  });

  return {
    payment_status: 'partial_refunded',
    remaining_discount_amount: remainingDiscountAmount,
  };
}

async function getPaymentEventByKey(env, idempotencyKey) {
  const rows = await supabaseRequest(
    env,
    `/payment_events?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=id,processed`,
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function getFinanceCategoryId(env, { name, type }) {
  const rows = await supabaseRequest(
    env,
    `/finance_categories?name=eq.${encodeURIComponent(name)}&type=eq.${encodeURIComponent(type)}&select=id&limit=1`,
  );
  const categoryId = Array.isArray(rows) && rows.length > 0
    ? String(rows[0]?.id || '').trim()
    : '';
  if (!categoryId) {
    throw new Error(`finance category not found: ${type}/${name}`);
  }
  return categoryId;
}

async function resolveFinanceCreatedByUserId(env, order) {
  const directUserId = String(order?.distributor_id || '').trim();
  if (directUserId) return directUserId;

  if (order?.store_id) {
    const storeRows = await supabaseRequest(
      env,
      `/stores?id=eq.${encodeURIComponent(String(order.store_id))}&select=distributor_id&limit=1`,
    );
    const storeUserId = Array.isArray(storeRows) && storeRows.length > 0
      ? String(storeRows[0]?.distributor_id || '').trim()
      : '';
    if (storeUserId) return storeUserId;
  }

  throw new Error(`finance created_by unavailable for order ${String(order?.id || '').trim()}`);
}

async function listFinanceTransactionsByOrder(env, orderId) {
  const rows = await supabaseRequest(
    env,
    `/financial_transactions?source_order_id=eq.${encodeURIComponent(orderId)}&select=id,transaction_type,category_id,amount,channel_name,description`,
  );
  return Array.isArray(rows) ? rows : [];
}

async function resolveRetailFinanceMode(env, order, paymentMethodInput) {
  const paymentMethod = String(paymentMethodInput || order?.payment_method || '').trim().toLowerCase();
  return {
    incomeCategoryName: '线下店铺回款',
    shouldCreateOnlineFee: true,
    incomeChannelName: 'offline_store_retail',
    feeChannelName: paymentMethod || 'offline_store_retail',
  };
}

async function ensureRetailPaymentFinanceRecords(env, order, {
  amount,
  paymentMethod,
  outTradeNo,
  transactionId,
  paymentPaidAt,
}) {
  const orderId = String(order?.id || '').trim();
  if (!orderId) {
    throw new Error('finance missing order id');
  }

  if (String(order?.order_kind || '').toLowerCase() !== 'retail') {
    return { skipped: true, reason: 'non_retail' };
  }

  const financeEventKey = buildPaymentEventKey({
    channel: paymentMethod,
    eventType: 'finance',
    outTradeNo,
    notifyId: null,
    tradeNo: null,
  });

  const paymentAmount = roundMoney(amount);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error(`finance invalid payment amount for order ${orderId}`);
  }

  const financeMode = await resolveRetailFinanceMode(env, order, paymentMethod);

  try {
    const existingFinanceEvent = await getPaymentEventByKey(env, financeEventKey);
    if (existingFinanceEvent?.processed) {
      return { skipped: true, reason: 'already_processed' };
    }

    const createdBy = await resolveFinanceCreatedByUserId(env, order);
    const feeAmount = roundMoney(paymentAmount * 0.006);
    const transactionDate = String(paymentPaidAt || order?.payment_paid_at || new Date().toISOString()).slice(0, 10);
    const [incomeCategoryId, expenseCategoryId, existingRows] = await Promise.all([
      getFinanceCategoryId(env, { name: financeMode.incomeCategoryName, type: 'income' }),
      financeMode.shouldCreateOnlineFee ? getFinanceCategoryId(env, { name: '线上佣金', type: 'expense' }) : Promise.resolve(null),
      listFinanceTransactionsByOrder(env, orderId),
    ]);

    const incomeDescription = `零售支付自动记账-收入-${orderId}`;
    const expenseDescription = `零售支付自动记账-佣金-${orderId}`;
    const incomeRow = existingRows.find((row) => String(row?.description || '').trim() === incomeDescription && String(row?.transaction_type || '').trim() === 'income');
    const expenseRow = existingRows.find((row) => String(row?.description || '').trim() === expenseDescription && String(row?.transaction_type || '').trim() === 'expense');
    const insertRows = [];

    if (!incomeRow) {
      insertRows.push({
        transaction_type: 'income',
        category_id: incomeCategoryId,
        amount: paymentAmount,
        transaction_date: transactionDate,
        store_id: order?.store_id || null,
        channel_name: financeMode.incomeChannelName,
        description: incomeDescription,
        is_recurring: false,
        created_by: createdBy,
        source_order_id: orderId,
      });
    } else {
      const needUpdateIncome = String(incomeRow?.category_id || '').trim() !== incomeCategoryId
        || !almostEqualAmount(Number(incomeRow?.amount || 0), paymentAmount)
        || String(incomeRow?.channel_name || '').trim() !== financeMode.incomeChannelName;
      if (needUpdateIncome) {
        await supabaseRequest(env, `/financial_transactions?id=eq.${encodeURIComponent(String(incomeRow.id || ''))}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            category_id: incomeCategoryId,
            amount: paymentAmount,
            channel_name: financeMode.incomeChannelName,
            transaction_date: transactionDate,
            updated_at: new Date().toISOString(),
          }),
        });
      }
    }

    if (financeMode.shouldCreateOnlineFee && expenseCategoryId) {
      if (!expenseRow) {
        insertRows.push({
          transaction_type: 'expense',
          category_id: expenseCategoryId,
          amount: feeAmount,
          transaction_date: transactionDate,
          store_id: order?.store_id || null,
          channel_name: financeMode.feeChannelName,
          description: expenseDescription,
          is_recurring: false,
          created_by: createdBy,
          source_order_id: orderId,
        });
      } else {
        const needUpdateExpense = String(expenseRow?.category_id || '').trim() !== expenseCategoryId
          || !almostEqualAmount(Number(expenseRow?.amount || 0), feeAmount)
          || String(expenseRow?.channel_name || '').trim() !== financeMode.feeChannelName;
        if (needUpdateExpense) {
          await supabaseRequest(env, `/financial_transactions?id=eq.${encodeURIComponent(String(expenseRow.id || ''))}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              category_id: expenseCategoryId,
              amount: feeAmount,
              channel_name: financeMode.feeChannelName,
              transaction_date: transactionDate,
              updated_at: new Date().toISOString(),
            }),
          });
        }
      }
    }

    if (insertRows.length > 0) {
      await supabaseRequest(env, '/financial_transactions', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(insertRows),
      });
    }

    await upsertPaymentEvent(env, {
      idempotency_key: financeEventKey,
      channel: paymentMethod,
      out_trade_no: outTradeNo,
      transaction_id: transactionId || order?.payment_transaction_id || null,
      notify_id: null,
      event_type: 'finance',
      status: 'paid',
      amount: paymentAmount,
      processed: true,
      payload: {
        orderId,
        storeId: order?.store_id || null,
        financeMode,
        createdBy,
        incomeDescription,
        expenseDescription,
        insertedCount: insertRows.length,
      },
    });

    return { skipped: false, insertedCount: insertRows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown finance sync error';
    try {
      await upsertPaymentEvent(env, {
        idempotency_key: financeEventKey,
        channel: paymentMethod,
        out_trade_no: outTradeNo,
        transaction_id: transactionId || order?.payment_transaction_id || null,
        notify_id: null,
        event_type: 'finance',
        status: 'failed',
        amount: paymentAmount,
        processed: false,
        payload: {
          orderId,
          error: message,
        },
      });
    } catch {
      // Ignore payment_events fallback failure and surface the original finance error.
    }
    throw error;
  }
}

async function ensureRetailRefundFinanceRecords(env, order, {
  refundAmount,
  paymentMethod,
  outTradeNo,
  refundNo,
  transactionId,
  refundAt,
}) {
  const orderId = String(order?.id || '').trim();
  if (!orderId) {
    throw new Error('finance refund missing order id');
  }

  if (String(order?.order_kind || '').toLowerCase() !== 'retail') {
    return { skipped: true, reason: 'non_retail' };
  }

  const normalizedRefundNo = String(refundNo || '').trim();
  const financeEventKey = buildPaymentEventKey({
    channel: paymentMethod,
    eventType: 'finance_refund',
    outTradeNo,
    notifyId: normalizedRefundNo || null,
    tradeNo: null,
  });

  const grossRefundAmount = Math.abs(roundMoney(refundAmount));
  const financeMode = await resolveRetailFinanceMode(env, order, paymentMethod);
  const feeAmount = financeMode.shouldCreateOnlineFee ? roundMoney(grossRefundAmount * 0.006) : 0;
  const amount = -Math.abs(roundMoney(grossRefundAmount - feeAmount));
  if (!Number.isFinite(amount) || amount >= 0) {
    throw new Error(`finance invalid refund amount for order ${orderId}`);
  }

  try {
    const existingFinanceEvent = await getPaymentEventByKey(env, financeEventKey);
    if (existingFinanceEvent?.processed) {
      return { skipped: true, reason: 'already_processed' };
    }

    const createdBy = await resolveFinanceCreatedByUserId(env, order);
    const transactionDate = String(refundAt || new Date().toISOString()).slice(0, 10);
    const incomeCategoryId = await getFinanceCategoryId(env, { name: financeMode.incomeCategoryName, type: 'income' });
    const description = normalizedRefundNo
      ? `零售退款自动冲减-收入-${orderId}-${normalizedRefundNo}`
      : `零售退款自动冲减-收入-${orderId}`;

    const existingRows = await supabaseRequest(
      env,
      `/financial_transactions?source_order_id=eq.${encodeURIComponent(orderId)}&description=eq.${encodeURIComponent(description)}&select=id,amount,category_id,channel_name&limit=1`,
    );

    if (!Array.isArray(existingRows) || existingRows.length === 0) {
      await supabaseRequest(env, '/financial_transactions', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          transaction_type: 'income',
          category_id: incomeCategoryId,
          amount,
          transaction_date: transactionDate,
          store_id: order?.store_id || null,
          channel_name: financeMode.incomeChannelName,
          description,
          is_recurring: false,
          created_by: createdBy,
          source_order_id: orderId,
        }),
      });
    } else {
      const existingRow = existingRows[0] || {};
      const needUpdateRefundIncome = String(existingRow?.category_id || '').trim() !== incomeCategoryId
        || !almostEqualAmount(Number(existingRow?.amount || 0), amount)
        || String(existingRow?.channel_name || '').trim() !== financeMode.incomeChannelName;
      if (needUpdateRefundIncome) {
        await supabaseRequest(env, `/financial_transactions?id=eq.${encodeURIComponent(String(existingRow.id || ''))}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            category_id: incomeCategoryId,
            amount,
            channel_name: financeMode.incomeChannelName,
            transaction_date: transactionDate,
            updated_at: new Date().toISOString(),
          }),
        });
      }
    }

    await upsertPaymentEvent(env, {
      idempotency_key: financeEventKey,
      channel: paymentMethod,
      out_trade_no: outTradeNo,
      transaction_id: transactionId || order?.payment_transaction_id || null,
      notify_id: normalizedRefundNo || null,
      event_type: 'finance_refund',
      status: 'paid',
      amount,
      processed: true,
      payload: {
        orderId,
        storeId: order?.store_id || null,
        financeMode,
        createdBy,
        grossRefundAmount,
        feeAmount,
        description,
      },
    });

    return { skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown finance refund sync error';
    try {
      await upsertPaymentEvent(env, {
        idempotency_key: financeEventKey,
        channel: paymentMethod,
        out_trade_no: outTradeNo,
        transaction_id: transactionId || order?.payment_transaction_id || null,
        notify_id: normalizedRefundNo || null,
        event_type: 'finance_refund',
        status: 'failed',
        amount,
        processed: false,
        payload: {
          orderId,
          error: message,
        },
      });
    } catch {
      // Ignore payment_events fallback failure and surface the original finance error.
    }
    throw error;
  }
}

async function upsertPaymentEvent(env, payload) {
  await supabaseRequest(env, '/payment_events?on_conflict=idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload),
  });
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...(init.headers || {}),
    },
  });
}

async function getRefundedAmount(env, outTradeNo) {
  const rows = await supabaseRequest(
    env,
    `/payment_events?out_trade_no=eq.${encodeURIComponent(outTradeNo)}&event_type=eq.refund&processed=eq.true&select=amount,status`,
  );

  if (!Array.isArray(rows)) return 0;

  return rows.reduce((sum, row) => {
    const status = String(row?.status || '').toLowerCase();
    if (status === 'failed' || status === 'timeout') return sum;
    return sum + Number(row?.amount || 0);
  }, 0);
}

function wechatNotifyResponse(code, message, status = 200) {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function getMobileLatestPayload(env) {
  const latestVersion = String(env.MOBILE_LATEST_VERSION || '').trim();
  const androidApkUrl = String(env.MOBILE_ANDROID_APK_URL || '').trim();
  const androidApkKey = String(env.MOBILE_ANDROID_APK_KEY || '').trim();

  return {
    latestVersion,
    androidApkUrl,
    androidApkKey,
    updatedAt: new Date().toISOString(),
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    const url = new URL(request.url);
    const isMock = env.PAYMENT_MOCK !== 'false';

    try {

    if (url.pathname === '/health') {
      return json({ ok: true, mock: isMock, ts: Date.now() });
    }

    if (url.pathname === '/api/payment/config-check' && request.method === 'GET') {
      const commonRequired = [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
      ];
      const wechatRequired = [
        'WECHAT_MCH_ID',
        'WECHAT_APP_ID',
        'WECHAT_SERIAL_NO',
        'WECHAT_PRIVATE_KEY',
        'WECHAT_API_V3_KEY',
        'WECHAT_PLATFORM_PUBLIC_KEY',
        'WECHAT_NOTIFY_URL',
      ];
      const alipayRequired = [
        'ALIPAY_APP_ID',
        'ALIPAY_PRIVATE_KEY',
        'ALIPAY_PUBLIC_KEY',
        'ALIPAY_NOTIFY_URL',
      ];

      const missingCommon = getMissingEnv(env, commonRequired);
      const missingWechat = [...missingCommon, ...getMissingEnv(env, wechatRequired)];
      const missingAlipay = [...missingCommon, ...getMissingEnv(env, alipayRequired)];
      const wechatLiveReady = missingWechat.length === 0;
      const alipayLiveReady = missingAlipay.length === 0;
      const missing = Array.from(new Set([...missingWechat, ...missingAlipay]));
      return json({
        ok: true,
        mock: isMock,
        liveReady: isMock ? false : wechatLiveReady || alipayLiveReady,
        missing,
        channels: {
          wechat: {
            liveReady: isMock ? false : wechatLiveReady,
            missing: missingWechat,
          },
          alipay: {
            liveReady: isMock ? false : alipayLiveReady,
            missing: missingAlipay,
          },
        },
      });
    }

    if (url.pathname === '/mobile/latest.json' && request.method === 'GET') {
      const payload = getMobileLatestPayload(env);
      const derivedDownloadUrl = payload.androidApkUrl
        || (payload.androidApkKey ? `${url.origin}/mobile/download/latest.apk` : '');
      const hasConfig = Boolean(payload.latestVersion && derivedDownloadUrl);
      return json(
        {
          ok: true,
          configured: hasConfig,
          latestVersion: payload.latestVersion,
          androidApkUrl: derivedDownloadUrl,
          androidApkKey: payload.androidApkKey,
          updatedAt: payload.updatedAt,
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=60',
          },
        },
      );
    }

    if (
      url.pathname === '/mobile/download/latest.apk'
      && (request.method === 'GET' || request.method === 'HEAD')
    ) {
      if (!env.MOBILE_APK_BUCKET) {
        return json({ ok: false, error: 'R2 bucket not configured' }, { status: 500 });
      }

      const payload = getMobileLatestPayload(env);
      const objectKey = payload.androidApkKey || 'latest.apk';

      const fileVersion = payload.latestVersion || 'latest';
      const fileName = `inventory-app-${fileVersion}.apk`;

      if (request.method === 'HEAD') {
        const metadata = await env.MOBILE_APK_BUCKET.head(objectKey);
        if (!metadata) {
          return json({ ok: false, error: 'APK not found in R2', key: objectKey }, { status: 404 });
        }

        const headers = {
          'Content-Type': metadata.httpMetadata?.contentType || 'application/vnd.android.package-archive',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'public, max-age=300',
          ...(metadata.httpEtag ? { ETag: metadata.httpEtag } : {}),
          ...(Number.isFinite(metadata.size) ? { 'Content-Length': String(metadata.size) } : {}),
        };

        return new Response(null, {
          status: 200,
          headers,
        });
      }

      const object = await env.MOBILE_APK_BUCKET.get(objectKey);

      if (!object) {
        return json({ ok: false, error: 'APK not found in R2', key: objectKey }, { status: 404 });
      }

      return new Response(object.body, {
        status: 200,
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'application/vnd.android.package-archive',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'public, max-age=300',
          ETag: object.httpEtag,
        },
      });
    }

    if (url.pathname === '/api/payment/create' && request.method === 'POST') {
      const body = await request.json();
      const orderId = String(body.orderId || `pay-${Date.now()}`);
      const method = body.paymentMethod === 'alipay' ? 'alipay' : 'wechat';
      const amount = Number(body.amount || 0);

      if (!orderId || !Number.isFinite(amount) || amount <= 0) {
        return json({ error: 'invalid params' }, { status: 400 });
      }

      if (isMock) {
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(`MOCK:${method}:${orderId}:${amount}`)}`;
        mockStore.set(orderId, { status: 'pending', method, amount, createdAt: Date.now() });
        return json({ success: true, orderId, qrCodeUrl });
      }

      // TODO: Replace with official provider integration.
      // WeChat Native: /v3/pay/transactions/native
      // Alipay Precreate: alipay.trade.precreate
      return json({ error: 'provider integration not configured' }, { status: 501 });
    }

    if (url.pathname === '/api/payment/collect' && request.method === 'POST') {
      const body = await request.json();
      const orderId = String(body.orderId || '').trim();
      const method = body.paymentMethod === 'wechat' ? 'wechat' : 'alipay';
      const amount = Number(body.amount || 0);
      const authCode = String(body.authCode || '').trim();
      const subject = String(body.subject || `订单收款-${orderId.slice(0, 8)}`);

      if (!orderId || !Number.isFinite(amount) || amount <= 0) {
        return json({ error: 'invalid params' }, { status: 400 });
      }

      if (method === 'wechat' && !wechatAuthCodePattern.test(authCode)) {
        return json({
          success: false,
          status: 'failed',
          error: '微信付款码格式错误，应为18位数字且以10-15开头',
        }, { status: 400 });
      }

      if (method === 'alipay' && !alipayAuthCodePattern.test(authCode)) {
        return json({
          success: false,
          status: 'failed',
          error: '支付宝付款码格式错误，应为16-24位数字且以25-30开头',
        }, { status: 400 });
      }

      if (isMock) {
        const transactionId = `mock_${method}_${Date.now()}`;
        mockStore.set(orderId, { status: 'paid', method, amount, transactionId, createdAt: Date.now() });
        return json({
          success: true,
          status: 'paid',
          orderId,
          outTradeNo: orderId,
          transactionId,
        });
      }

      if (method === 'wechat') {
        const missing = getMissingEnv(env, [
          'SUPABASE_URL',
          'SUPABASE_SERVICE_ROLE_KEY',
          'WECHAT_MCH_ID',
          'WECHAT_APP_ID',
          'WECHAT_SERIAL_NO',
          'WECHAT_PRIVATE_KEY',
        ]);
        if (missing.length > 0) {
          return json({ success: false, status: 'failed', error: `missing env: ${missing.join(',')}` }, { status: 500 });
        }

        const order = await getOrderById(env, orderId);
        if (!order) {
          return json({ success: false, status: 'failed', error: '订单不存在' }, { status: 404 });
        }

        const expectedAmount = Number(order.payment_amount || order.total_retail_amount || 0);
        if (!almostEqualAmount(expectedAmount, amount)) {
          return json({
            success: false,
            status: 'failed',
            error: `订单金额不匹配，期望 ${expectedAmount.toFixed(2)}`,
          }, { status: 400 });
        }

        await patchOrderPayment(env, orderId, {
          payment_method: 'wechat',
          payment_status: 'pending',
          payment_amount: amount,
        });

        const wechatOutTradeNo = toWechatOutTradeNo(orderId);
        const storeId = String(env.WECHAT_STORE_ID || 'STORE-001').trim().slice(0, 32);
        const wechatCollectPayload = {
          appid: String(env.WECHAT_APP_ID || '').trim(),
          mchid: String(env.WECHAT_MCH_ID || '').trim(),
          description: subject,
          out_trade_no: wechatOutTradeNo,
          amount: {
            total: Math.round(amount * 100),
            currency: 'CNY',
          },
          payer: {
            auth_code: authCode,
          },
          scene_info: {
            store_info: {
              id: storeId,
            },
          },
        };

        let collectResult;
        try {
          collectResult = await postWechatRequest(env, 'POST', '/v3/pay/transactions/micropay', wechatCollectPayload);
        } catch (error) {
          await patchOrderPayment(env, orderId, { payment_status: 'failed' });
          const message = error instanceof Error ? error.message : 'wechat request failed';
          return json({
            success: false,
            status: 'failed',
            error: `微信收款请求异常：${message}`,
            orderId,
            outTradeNo: orderId,
          }, { status: 500 });
        }

        if (!collectResult.ok && collectResult.httpStatus === 404) {
          try {
            collectResult = await postWechatRequest(env, 'POST', '/v3/pay/transactions/codepay', wechatCollectPayload);
          } catch (error) {
            await patchOrderPayment(env, orderId, { payment_status: 'failed' });
            const message = error instanceof Error ? error.message : 'wechat codepay request failed';
            return json({
              success: false,
              status: 'failed',
              error: `微信收款请求异常：${message}`,
              orderId,
              outTradeNo: wechatOutTradeNo,
            }, { status: 500 });
          }
        }

        const wechatTransactionId = collectResult.data?.transaction_id || null;
        const finalStatus = collectResult.ok ? collectResult.status : mapWechatErrorCodeToStatus(collectResult.code);
        let financeWarning = null;

        if (finalStatus === 'paid') {
          const paymentPaidAt = new Date().toISOString();
          await patchOrderPayment(env, orderId, {
            payment_status: 'paid',
            payment_transaction_id: wechatTransactionId,
            payment_paid_at: paymentPaidAt,
          });
          try {
            await ensureRetailPaymentFinanceRecords(env, order, {
              amount,
              paymentMethod: 'wechat',
              outTradeNo: wechatOutTradeNo,
              transactionId: wechatTransactionId,
              paymentPaidAt,
            });
          } catch (error) {
            financeWarning = `支付已成功，但自动记账失败：${error instanceof Error ? error.message : 'unknown finance error'}`;
          }
        } else if (finalStatus === 'pending') {
          await patchOrderPayment(env, orderId, { payment_status: 'pending' });
        } else {
          await patchOrderPayment(env, orderId, { payment_status: finalStatus === 'timeout' ? 'timeout' : 'failed' });
        }

        await upsertPaymentEvent(env, {
          idempotency_key: buildPaymentEventKey({
            channel: 'wechat',
            eventType: 'collect',
            outTradeNo: wechatOutTradeNo,
            tradeNo: wechatTransactionId,
          }),
          channel: 'wechat',
          out_trade_no: wechatOutTradeNo,
          transaction_id: wechatTransactionId,
          notify_id: null,
          event_type: 'collect',
          status: finalStatus,
          amount,
          processed: true,
          payload: collectResult.data || { code: collectResult.code, error: collectResult.error },
        });

        if (finalStatus === 'pending') {
          return json({
            success: true,
            status: 'pending',
            orderId,
            outTradeNo: wechatOutTradeNo,
            transactionId: wechatTransactionId || undefined,
          });
        }

        if (finalStatus === 'paid') {
          return json({
            success: true,
            status: 'paid',
            orderId,
            outTradeNo: wechatOutTradeNo,
            transactionId: wechatTransactionId || undefined,
            warning: financeWarning || undefined,
          });
        }

        return json({
          success: false,
          status: finalStatus,
          error: (() => {
            const code = String(collectResult.code || '').toUpperCase();
            const base = collectResult.error || '微信付款码收款失败';
            const requestIdSuffix = collectResult.requestId ? `（Request-ID: ${collectResult.requestId}）` : '';
            if (code === 'SIGN_ERROR') {
              return `微信签名验证不通过，请核对 WECHAT_PRIVATE_KEY 与 WECHAT_SERIAL_NO 是否同一商户证书，且与商户平台当前证书一致${requestIdSuffix}`;
            }
            return `${base}${requestIdSuffix}`;
          })(),
          orderId,
          outTradeNo: wechatOutTradeNo,
          transactionId: wechatTransactionId || undefined,
        }, { status: 400 });
      }

      const missing = getMissingEnv(env, [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'ALIPAY_APP_ID',
        'ALIPAY_PRIVATE_KEY',
        'ALIPAY_PUBLIC_KEY',
        'ALIPAY_NOTIFY_URL',
      ]);
      if (missing.length > 0) {
        return json({ success: false, status: 'failed', error: `missing env: ${missing.join(',')}` }, { status: 500 });
      }

      const order = await getOrderById(env, orderId);
      if (!order) {
        return json({ success: false, status: 'failed', error: '订单不存在' }, { status: 404 });
      }

      const expectedAmount = Number(order.payment_amount || order.total_retail_amount || 0);
      if (!almostEqualAmount(expectedAmount, amount)) {
        return json({
          success: false,
          status: 'failed',
          error: `订单金额不匹配，期望 ${expectedAmount.toFixed(2)}`,
        }, { status: 400 });
      }

      await patchOrderPayment(env, orderId, {
        payment_method: 'alipay',
        payment_status: 'pending',
        payment_amount: amount,
      });

      const alipayResult = await postAlipayRequest(env, 'alipay.trade.pay', {
        out_trade_no: orderId,
        scene: 'bar_code',
        auth_code: authCode,
        subject,
        total_amount: amount.toFixed(2),
        product_code: 'FACE_TO_FACE_PAYMENT',
      });

      let financeWarning = null;

      if (!alipayResult.ok) {
        const alipayError = String(alipayResult.error || '支付宝请求失败');
        const signatureHint = alipayError.includes('验签')
          ? `；请确认 ALIPAY_PRIVATE_KEY 与应用公钥配对，并使用包含 sign_type 的待签名串。sign_content=${alipayResult.signContent || ''}`
          : '';
        await patchOrderPayment(env, orderId, { payment_status: 'failed' });
        await upsertPaymentEvent(env, {
          idempotency_key: buildPaymentEventKey({
            channel: 'alipay',
            eventType: 'collect',
            outTradeNo: orderId,
            tradeNo: null,
          }),
          channel: 'alipay',
          out_trade_no: orderId,
          transaction_id: null,
          notify_id: null,
          event_type: 'collect',
          status: 'failed',
          amount,
          processed: true,
          payload: { error: alipayError, code: alipayResult.code, sign_content: alipayResult.signContent || null },
        });
        return json({ success: false, status: 'failed', error: `${alipayError}${signatureHint}` }, { status: 400 });
      }

      if (alipayResult.status === 'paid') {
        const paymentPaidAt = new Date().toISOString();
        await patchOrderPayment(env, orderId, {
          payment_status: 'paid',
          payment_transaction_id: alipayResult.data.trade_no || null,
          payment_paid_at: paymentPaidAt,
        });
        try {
          await ensureRetailPaymentFinanceRecords(env, order, {
            amount: Number(alipayResult.data?.total_amount || amount),
            paymentMethod: 'alipay',
            outTradeNo: alipayResult.data.out_trade_no || orderId,
            transactionId: alipayResult.data.trade_no || null,
            paymentPaidAt,
          });
        } catch (error) {
          financeWarning = `支付已成功，但自动记账失败：${error instanceof Error ? error.message : 'unknown finance error'}`;
        }
      } else {
        await patchOrderPayment(env, orderId, { payment_status: 'pending' });
      }

      await upsertPaymentEvent(env, {
        idempotency_key: buildPaymentEventKey({
          channel: 'alipay',
          eventType: 'collect',
          outTradeNo: orderId,
          tradeNo: alipayResult.data.trade_no,
        }),
        channel: 'alipay',
        out_trade_no: orderId,
        transaction_id: alipayResult.data.trade_no || null,
        notify_id: null,
        event_type: 'collect',
        status: alipayResult.status,
        amount,
        processed: true,
        payload: alipayResult.data,
      });

      if (alipayResult.status === 'pending') {
        return json({
          success: true,
          status: 'pending',
          orderId,
          outTradeNo: orderId,
        });
      }

      return json({
        success: true,
        status: 'paid',
        orderId,
        outTradeNo: alipayResult.data.out_trade_no || orderId,
        transactionId: alipayResult.data.trade_no,
        warning: financeWarning || undefined,
      });
    }

    if (url.pathname === '/api/payment/refund-requests' && request.method === 'GET') {
      const approverUserId = String(url.searchParams.get('approverUserId') || '').trim();
      const status = String(url.searchParams.get('status') || 'pending').trim();
      const limitRaw = Number(url.searchParams.get('limit') || 30);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 30;
      if (!approverUserId) {
        return json({ success: false, status: 'failed', error: 'missing approver user id' }, { status: 400 });
      }

      const rows = await supabaseRequest(
        env,
        `/refund_requests?approver_user_id=eq.${encodeURIComponent(approverUserId)}&status=eq.${encodeURIComponent(status)}&select=*&order=created_at.desc&limit=${limit}`,
      );

      return json({
        success: true,
        requests: Array.isArray(rows) ? rows : [],
      });
    }

    if (url.pathname === '/api/payment/refund-request' && request.method === 'POST') {
      const body = await request.json();
      const orderId = String(body.orderId || '').trim();
      const requesterUserId = String(body.requesterUserId || '').trim();
      const reason = String(body.reason || '门店退款').trim().slice(0, 128);
      const orderItemIds = Array.isArray(body.orderItemIds)
        ? Array.from(new Set(body.orderItemIds.map((itemId) => String(itemId || '').trim()).filter(Boolean)))
        : [];

      if (!orderId) {
        return json({ success: false, status: 'failed', error: 'missing order id' }, { status: 400 });
      }
      if (!requesterUserId) {
        return json({ success: false, status: 'failed', error: 'missing requester user id' }, { status: 400 });
      }
      if (orderItemIds.length === 0) {
        return json({ success: false, status: 'failed', error: 'missing order item ids' }, { status: 400 });
      }

      const order = await getOrderWithItems(env, orderId);
      if (!order) {
        return json({ success: false, status: 'failed', error: '订单不存在' }, { status: 404 });
      }
      if (String(order.order_kind || '').toLowerCase() !== 'retail') {
        return json({ success: false, status: 'failed', error: '仅零售订单支持退款申请' }, { status: 400 });
      }

      const orderPaymentStatus = String(order.payment_status || '').toLowerCase();
      if (!['paid', 'partial_refunded'].includes(orderPaymentStatus)) {
        return json({ success: false, status: 'failed', error: '仅已支付或部分退款订单可提交退款申请' }, { status: 400 });
      }

      const orderItems = Array.isArray(order.items) ? order.items : [];
      const selectedItems = orderItems.filter((item) => orderItemIds.includes(String(item.id || '')));
      if (selectedItems.length !== orderItemIds.length) {
        return json({ success: false, status: 'failed', error: '存在无效退款商品行' }, { status: 400 });
      }
      const requestedAmount = Number(
        selectedItems
          .reduce((sum, item) => sum + Number(item.discount_price || 0) * Number(item.quantity || 0), 0)
          .toFixed(2),
      );

      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        return json({ success: false, status: 'failed', error: '退款金额无效' }, { status: 400 });
      }

      const approverUserId = await resolveRefundApproverUserId(env, order);
      if (!approverUserId) {
        return json({ success: false, status: 'failed', error: '订单未找到收款账号，无法发起审批' }, { status: 400 });
      }

      const existingRows = await supabaseRequest(
        env,
        `/refund_requests?order_id=eq.${encodeURIComponent(orderId)}&status=eq.pending&select=id&limit=1`,
      );
      if (Array.isArray(existingRows) && existingRows.length > 0) {
        return json({ success: false, status: 'failed', error: '该订单已有待审批退款申请，请先处理现有申请' }, { status: 409 });
      }

      const insertRows = await supabaseRequest(env, '/refund_requests?select=*', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          order_id: orderId,
          requester_user_id: requesterUserId,
          approver_user_id: approverUserId,
          status: 'pending',
          reason,
          requested_item_ids: orderItemIds,
          requested_amount: requestedAmount,
        }),
      });

      const requestRow = Array.isArray(insertRows) && insertRows.length > 0 ? insertRows[0] : null;
      if (!requestRow?.id) {
        return json({ success: false, status: 'failed', error: '退款申请创建失败' }, { status: 500 });
      }

      await insertNotification(env, {
        userId: approverUserId,
        type: 'refund_requested',
        orderId,
        message: `订单 #${orderId.slice(0, 8)} 收到退款审批申请，金额 ¥${requestedAmount.toFixed(2)}，请处理。`,
      });

      return json({
        success: true,
        requestId: requestRow.id,
        approverUserId,
        requestedAmount,
      });
    }

    if (url.pathname === '/api/payment/refund-request/reject' && request.method === 'POST') {
      const body = await request.json();
      const requestId = String(body.requestId || '').trim();
      const operatorUserId = String(body.operatorUserId || '').trim();
      const rejectReason = String(body.rejectReason || '收款账号拒绝退款').trim().slice(0, 128);

      if (!requestId) {
        return json({ success: false, status: 'failed', error: 'missing request id' }, { status: 400 });
      }
      if (!operatorUserId) {
        return json({ success: false, status: 'failed', error: 'missing operator user id' }, { status: 400 });
      }

      const requestRow = await getRefundRequestById(env, requestId);
      if (!requestRow) {
        return json({ success: false, status: 'failed', error: '退款申请不存在' }, { status: 404 });
      }
      if (String(requestRow.status || '').toLowerCase() !== 'pending') {
        return json({ success: false, status: 'failed', error: '退款申请状态不是待审批，无法拒绝' }, { status: 409 });
      }
      if (String(requestRow.approver_user_id || '') !== operatorUserId) {
        return json({ success: false, status: 'failed', error: '仅收款账号可拒绝该退款申请' }, { status: 403 });
      }

      await supabaseRequest(env, `/refund_requests?id=eq.${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'rejected',
          reject_reason: rejectReason,
          rejected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });

      await insertNotification(env, {
        userId: requestRow.requester_user_id,
        type: 'refund_rejected',
        orderId: requestRow.order_id,
        message: `订单 #${String(requestRow.order_id || '').slice(0, 8)} 的退款申请已被收款账号拒绝。`,
      });

      return json({ success: true, status: 'rejected' });
    }

    if (url.pathname === '/api/payment/refund-request/approve' && request.method === 'POST') {
      const body = await request.json();
      const requestId = String(body.requestId || '').trim();
      const operatorUserId = String(body.operatorUserId || '').trim();

      if (!requestId) {
        return json({ success: false, status: 'failed', error: 'missing request id' }, { status: 400 });
      }
      if (!operatorUserId) {
        return json({ success: false, status: 'failed', error: 'missing operator user id' }, { status: 400 });
      }

      const requestRow = await getRefundRequestById(env, requestId);
      if (!requestRow) {
        return json({ success: false, status: 'failed', error: '退款申请不存在' }, { status: 404 });
      }
      if (String(requestRow.status || '').toLowerCase() !== 'pending') {
        return json({ success: false, status: 'failed', error: '退款申请状态不是待审批，无法同意' }, { status: 409 });
      }
      if (String(requestRow.approver_user_id || '') !== operatorUserId) {
        return json({ success: false, status: 'failed', error: '仅收款账号可同意该退款申请' }, { status: 403 });
      }

      await supabaseRequest(env, `/refund_requests?id=eq.${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'approved',
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });

      const refundResultResponse = await fetch(`${url.origin}/api/payment/refund-items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          approvedRequestId: requestId,
          orderId: requestRow.order_id,
          orderItemIds: Array.isArray(requestRow.requested_item_ids) ? requestRow.requested_item_ids : [],
          reason: requestRow.reason || '门店退款',
        }),
      });

      const refundPayload = await refundResultResponse.json();
      if (!refundResultResponse.ok || !refundPayload.success) {
        await supabaseRequest(env, `/refund_requests?id=eq.${encodeURIComponent(requestId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            status: 'failed',
            processed_at: new Date().toISOString(),
            provider_response: refundPayload || null,
            updated_at: new Date().toISOString(),
          }),
        });

        await insertNotification(env, {
          userId: requestRow.approver_user_id,
          type: 'refund_failed',
          orderId: requestRow.order_id,
          message: `订单 #${String(requestRow.order_id || '').slice(0, 8)} 退款执行失败，请重试。`,
        });

        return json({
          success: false,
          status: 'failed',
          error: String(refundPayload?.error || '退款执行失败'),
          refundResult: refundPayload || null,
        }, { status: 400 });
      }

      await supabaseRequest(env, `/refund_requests?id=eq.${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'completed',
          processed_at: new Date().toISOString(),
          provider_response: refundPayload || null,
          updated_at: new Date().toISOString(),
        }),
      });

      await insertNotification(env, {
        userId: requestRow.approver_user_id,
        type: 'refund_completed',
        orderId: requestRow.order_id,
        message: `订单 #${String(requestRow.order_id || '').slice(0, 8)} 退款已执行，金额 ¥${Number(refundPayload.refundAmount || requestRow.requested_amount || 0).toFixed(2)}。`,
      });

      if (requestRow.requester_user_id && requestRow.requester_user_id !== requestRow.approver_user_id) {
        await insertNotification(env, {
          userId: requestRow.requester_user_id,
          type: 'refund_approved',
          orderId: requestRow.order_id,
          message: `订单 #${String(requestRow.order_id || '').slice(0, 8)} 退款申请已通过并执行退款。`,
        });
      }

      return json({
        success: true,
        status: 'completed',
        refundResult: refundPayload,
      });
    }

    if (url.pathname === '/api/payment/refund' && request.method === 'POST') {
      const body = await request.json();
      const orderId = String(body.orderId || '').trim();
      const reason = String(body.reason || '门店退款').trim().slice(0, 128);

      if (!orderId) {
        return json({ success: false, status: 'failed', error: 'missing order id' }, { status: 400 });
      }

      const order = await getOrderById(env, orderId);
      if (!order) {
        return json({ success: false, status: 'failed', error: '订单不存在' }, { status: 404 });
      }

      if (String(order.payment_status || '').toLowerCase() !== 'paid') {
        if (String(order.payment_status || '').toLowerCase() !== 'partial_refunded') {
          return json({ success: false, status: 'failed', error: '仅已支付或部分退款订单可退款' }, { status: 400 });
        }
      }

      const totalAmount = Number(order.payment_amount || order.total_retail_amount || 0);
      const inputAmount = Number(body.amount || 0);
      if (!Number.isFinite(inputAmount) || inputAmount <= 0) {
        return json({ success: false, status: 'failed', error: '退款金额无效' }, { status: 400 });
      }

      const refundAmount = Number(inputAmount.toFixed(2));

      if (order.payment_method === 'wechat') {
        const missing = getMissingEnv(env, [
          'WECHAT_MCH_ID',
          'WECHAT_SERIAL_NO',
          'WECHAT_PRIVATE_KEY',
        ]);
        if (missing.length > 0) {
          return json({ success: false, status: 'failed', error: `missing env: ${missing.join(',')}` }, { status: 500 });
        }

        const outTradeNo = toWechatOutTradeNo(orderId);
        const refundedAmount = await getRefundedAmount(env, outTradeNo);
        const remainAmount = Number((totalAmount - refundedAmount).toFixed(2));
        if (remainAmount <= 0) {
          let syncWarning = null;
          try {
            await patchOrderPayment(env, orderId, { payment_status: 'refunded' });
          } catch (patchError) {
            syncWarning = `已无可退款金额，但状态回写失败：${patchError instanceof Error ? patchError.message : 'unknown patch error'}`;
          }
          return json({
            success: true,
            status: 'refunded',
            orderId,
            refundAmount: 0,
            refundedAmount,
            remainAmount: 0,
            warning: syncWarning,
            message: '该订单已无可退款金额，按已退款处理',
          });
        }
        if (refundAmount - remainAmount > 0.000001) {
          return json({ success: false, status: 'failed', error: `退款金额不能大于剩余可退金额 ${remainAmount.toFixed(2)}` }, { status: 400 });
        }

        const outRefundNo = `R${outTradeNo.slice(0, 20)}${Date.now().toString().slice(-12)}`;
        const refundPayload = {
          out_trade_no: outTradeNo,
          out_refund_no: outRefundNo,
          reason,
          notify_url: env.WECHAT_REFUND_NOTIFY_URL || undefined,
          amount: {
            refund: Math.round(refundAmount * 100),
            total: Math.round(totalAmount * 100),
            currency: 'CNY',
          },
        };

        const refundResult = await postWechatRequest(env, 'POST', '/v3/refund/domestic/refunds', refundPayload);
        if (!refundResult.ok) {
          const requestIdSuffix = refundResult.requestId ? `（Request-ID: ${refundResult.requestId}）` : '';
          return json({ success: false, status: 'failed', error: `${refundResult.error || '微信退款失败'}${requestIdSuffix}` }, { status: 400 });
        }

        const refundState = String(refundResult.data?.status || '').toUpperCase();
        const nextRefundedAmount = Number((refundedAmount + refundAmount).toFixed(2));
        const isFullyRefunded = nextRefundedAmount >= Number((totalAmount - 0.000001).toFixed(2));
        const paymentStatus = isFullyRefunded
          ? (refundState === 'SUCCESS' ? 'refunded' : 'refund_pending')
          : (refundState === 'SUCCESS' ? 'partial_refunded' : 'partial_refund_pending');

        await patchOrderPayment(env, orderId, {
          payment_status: paymentStatus,
        });

        await upsertPaymentEvent(env, {
          idempotency_key: buildPaymentEventKey({
            channel: 'wechat',
            eventType: 'refund',
            outTradeNo,
            notifyId: outRefundNo,
            tradeNo: order.payment_transaction_id || null,
          }),
          channel: 'wechat',
          out_trade_no: outTradeNo,
          transaction_id: order.payment_transaction_id || null,
          notify_id: null,
          event_type: 'refund',
          status: paymentStatus,
          amount: refundAmount,
          processed: true,
          payload: refundResult.data,
        });

        let financeWarning = null;
        try {
          await ensureRetailRefundFinanceRecords(env, order, {
            refundAmount,
            paymentMethod: 'wechat',
            outTradeNo,
            refundNo: outRefundNo,
            transactionId: order.payment_transaction_id || null,
            refundAt: new Date().toISOString(),
          });
        } catch (error) {
          financeWarning = `退款已成功，但自动冲减记账失败：${error instanceof Error ? error.message : 'unknown finance error'}`;
        }

        return json({
          success: true,
          status: paymentStatus,
          orderId,
          refundAmount,
          refundedAmount: nextRefundedAmount,
          remainAmount: Number((totalAmount - nextRefundedAmount).toFixed(2)),
          refundNo: outRefundNo,
          warning: financeWarning || undefined,
        });
      }

      if (order.payment_method === 'alipay') {
        const missing = getMissingEnv(env, [
          'ALIPAY_APP_ID',
          'ALIPAY_PRIVATE_KEY',
          'ALIPAY_PUBLIC_KEY',
        ]);
        if (missing.length > 0) {
          return json({ success: false, status: 'failed', error: `missing env: ${missing.join(',')}` }, { status: 500 });
        }

        const outTradeNo = orderId;
        const refundedAmount = await getRefundedAmount(env, outTradeNo);
        const remainAmount = Number((totalAmount - refundedAmount).toFixed(2));
        if (remainAmount <= 0) {
          let syncWarning = null;
          try {
            await patchOrderPayment(env, orderId, { payment_status: 'refunded' });
          } catch (patchError) {
            syncWarning = `已无可退款金额，但状态回写失败：${patchError instanceof Error ? patchError.message : 'unknown patch error'}`;
          }
          return json({
            success: true,
            status: 'refunded',
            orderId,
            refundAmount: 0,
            refundedAmount,
            remainAmount: 0,
            warning: syncWarning,
            message: '该订单已无可退款金额，按已退款处理',
          });
        }
        if (refundAmount - remainAmount > 0.000001) {
          return json({ success: false, status: 'failed', error: `退款金额不能大于剩余可退金额 ${remainAmount.toFixed(2)}` }, { status: 400 });
        }

        const outRequestNo = `R${orderId.slice(0, 8)}${Date.now()}`;
        const refundResult = await postAlipayRefundRequest(env, {
          out_trade_no: orderId,
          trade_no: order.payment_transaction_id || undefined,
          refund_amount: refundAmount.toFixed(2),
          refund_reason: reason,
          out_request_no: outRequestNo,
        });

        if (!refundResult.ok) {
          return json({ success: false, status: 'failed', error: refundResult.error || '支付宝退款失败' }, { status: 400 });
        }

        const nextRefundedAmount = Number((refundedAmount + refundAmount).toFixed(2));
        const isFullyRefunded = nextRefundedAmount >= Number((totalAmount - 0.000001).toFixed(2));
        const paymentStatus = isFullyRefunded
          ? (refundResult.status === 'refunded' ? 'refunded' : 'refund_pending')
          : (refundResult.status === 'refunded' ? 'partial_refunded' : 'partial_refund_pending');

        await patchOrderPayment(env, orderId, {
          payment_status: paymentStatus,
        });

        await upsertPaymentEvent(env, {
          idempotency_key: buildPaymentEventKey({
            channel: 'alipay',
            eventType: 'refund',
            outTradeNo: orderId,
            notifyId: outRequestNo,
            tradeNo: order.payment_transaction_id || null,
          }),
          channel: 'alipay',
          out_trade_no: orderId,
          transaction_id: order.payment_transaction_id || null,
          notify_id: null,
          event_type: 'refund',
          status: paymentStatus,
          amount: refundAmount,
          processed: true,
          payload: refundResult.data,
        });

        let financeWarning = null;
        try {
          await ensureRetailRefundFinanceRecords(env, order, {
            refundAmount,
            paymentMethod: 'alipay',
            outTradeNo: orderId,
            refundNo: outRequestNo,
            transactionId: order.payment_transaction_id || null,
            refundAt: new Date().toISOString(),
          });
        } catch (error) {
          financeWarning = `退款已成功，但自动冲减记账失败：${error instanceof Error ? error.message : 'unknown finance error'}`;
        }

        return json({
          success: true,
          status: paymentStatus,
          orderId,
          refundAmount,
          refundedAmount: nextRefundedAmount,
          remainAmount: Number((totalAmount - nextRefundedAmount).toFixed(2)),
          refundNo: outRequestNo,
          warning: financeWarning || undefined,
        });
      }

      return json({ success: false, status: 'failed', error: '订单未记录支付渠道，无法退款' }, { status: 400 });
    }

    if (url.pathname === '/api/payment/refund-items' && request.method === 'POST') {
      try {
      const body = await request.json();
      const orderId = String(body.orderId || '').trim();
      const requesterUserId = String(body.requesterUserId || '').trim();
      const orderItemIds = Array.isArray(body.orderItemIds)
        ? Array.from(new Set(body.orderItemIds.map((itemId) => String(itemId || '').trim()).filter(Boolean)))
        : [];

      if (!orderId) {
        return json({ success: false, status: 'failed', error: 'missing order id' }, { status: 400 });
      }
      if (orderItemIds.length === 0) {
        return json({ success: false, status: 'failed', error: 'missing order item ids' }, { status: 400 });
      }
      const reason = String(body.reason || '门店退款').trim().slice(0, 128);

      const order = await getOrderWithItems(env, orderId);
      if (!order) {
        return json({ success: false, status: 'failed', error: '订单不存在' }, { status: 404 });
      }
      const merchantUserId = await resolveRefundApproverUserId(env, order);

      if (String(order.order_kind || '').toLowerCase() !== 'retail') {
        return json({ success: false, status: 'failed', error: '仅零售订单支持按商品退款' }, { status: 400 });
      }

      const orderPaymentStatus = String(order.payment_status || '').toLowerCase();
      if (!['paid', 'partial_refunded'].includes(orderPaymentStatus)) {
        return json({ success: false, status: 'failed', error: '仅已支付或部分退款订单可退款' }, { status: 400 });
      }

      const orderItems = Array.isArray(order.items) ? order.items : [];
      const selectedItems = orderItems.filter((item) => orderItemIds.includes(String(item.id || '')));
      if (selectedItems.length !== orderItemIds.length) {
        return json({ success: false, status: 'failed', error: '存在无效退款商品行' }, { status: 400 });
      }
      const refundedItemsSnapshot = buildRefundedItemsSnapshot(selectedItems);

      const refundAmount = Number(
        selectedItems
          .reduce((sum, item) => sum + Number(item.discount_price || 0) * Number(item.quantity || 0), 0)
          .toFixed(2),
      );
      if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        return json({ success: false, status: 'failed', error: '退款金额无效' }, { status: 400 });
      }

      const totalAmount = Number(order.payment_amount || order.total_retail_amount || 0);
      let finalStatus = 'failed';
      let refundNo = null;
      let outTradeNo = orderId;
      let providerPayload = null;
      let isRefundSuccess = false;
      let mutationWarning = null;

      if (order.payment_method === 'wechat') {
        const missing = getMissingEnv(env, [
          'WECHAT_MCH_ID',
          'WECHAT_SERIAL_NO',
          'WECHAT_PRIVATE_KEY',
        ]);
        if (missing.length > 0) {
          return json({ success: false, status: 'failed', error: `missing env: ${missing.join(',')}` }, { status: 500 });
        }

        outTradeNo = toWechatOutTradeNo(orderId);
        const refundedAmount = await getRefundedAmount(env, outTradeNo);
        const remainAmount = Number((totalAmount - refundedAmount).toFixed(2));
        if (remainAmount <= 0) {
          let syncWarning = null;
          try {
            await patchOrderPayment(env, orderId, { payment_status: 'refunded' });
          } catch (patchError) {
            syncWarning = `已无可退款金额，但状态回写失败：${patchError instanceof Error ? patchError.message : 'unknown patch error'}`;
          }
          return json({
            success: true,
            status: 'refunded',
            orderId,
            refundAmount: 0,
            refundedAmount,
            remainAmount: 0,
            warning: syncWarning,
            message: '该订单已无可退款金额，按已退款处理',
          });
        }
        if (refundAmount - remainAmount > 0.000001) {
          return json({ success: false, status: 'failed', error: `退款金额不能大于剩余可退金额 ${remainAmount.toFixed(2)}` }, { status: 400 });
        }

        refundNo = `R${outTradeNo.slice(0, 20)}${Date.now().toString().slice(-12)}`;
        const refundPayload = {
          out_trade_no: outTradeNo,
          out_refund_no: refundNo,
          reason,
          notify_url: env.WECHAT_REFUND_NOTIFY_URL || undefined,
          amount: {
            refund: Math.round(refundAmount * 100),
            total: Math.round(totalAmount * 100),
            currency: 'CNY',
          },
        };

        const refundResult = await postWechatRequest(env, 'POST', '/v3/refund/domestic/refunds', refundPayload);
        if (!refundResult.ok) {
          const requestIdSuffix = refundResult.requestId ? `（Request-ID: ${refundResult.requestId}）` : '';
          return json({ success: false, status: 'failed', error: `${refundResult.error || '微信退款失败'}${requestIdSuffix}` }, { status: 400 });
        }

        const refundState = String(refundResult.data?.status || '').toUpperCase();
        isRefundSuccess = true;
        const isFullRemainingRefund = (remainAmount - refundAmount) <= 0.000001;
        finalStatus = isFullRemainingRefund ? 'refunded' : 'partial_refunded';
        if (refundState && refundState !== 'SUCCESS') {
          mutationWarning = `渠道返回状态 ${refundState}，已按受理成功同步本地退款明细与库存`;
        }
        providerPayload = refundResult.data;
      } else if (order.payment_method === 'alipay') {
        const missing = getMissingEnv(env, [
          'ALIPAY_APP_ID',
          'ALIPAY_PRIVATE_KEY',
          'ALIPAY_PUBLIC_KEY',
        ]);
        if (missing.length > 0) {
          return json({ success: false, status: 'failed', error: `missing env: ${missing.join(',')}` }, { status: 500 });
        }

        outTradeNo = orderId;
        const refundedAmount = await getRefundedAmount(env, outTradeNo);
        const remainAmount = Number((totalAmount - refundedAmount).toFixed(2));
        if (remainAmount <= 0) {
          let syncWarning = null;
          try {
            await patchOrderPayment(env, orderId, { payment_status: 'refunded' });
          } catch (patchError) {
            syncWarning = `已无可退款金额，但状态回写失败：${patchError instanceof Error ? patchError.message : 'unknown patch error'}`;
          }
          return json({
            success: true,
            status: 'refunded',
            orderId,
            refundAmount: 0,
            refundedAmount,
            remainAmount: 0,
            warning: syncWarning,
            message: '该订单已无可退款金额，按已退款处理',
          });
        }
        if (refundAmount - remainAmount > 0.000001) {
          return json({ success: false, status: 'failed', error: `退款金额不能大于剩余可退金额 ${remainAmount.toFixed(2)}` }, { status: 400 });
        }

        refundNo = `R${orderId.slice(0, 8)}${Date.now()}`;
        const refundResult = await postAlipayRefundRequest(env, {
          out_trade_no: orderId,
          trade_no: order.payment_transaction_id || undefined,
          refund_amount: refundAmount.toFixed(2),
          refund_reason: reason,
          out_request_no: refundNo,
        });

        if (!refundResult.ok) {
          return json({ success: false, status: 'failed', error: refundResult.error || '支付宝退款失败' }, { status: 400 });
        }

        isRefundSuccess = true;
        const isFullRemainingRefund = (remainAmount - refundAmount) <= 0.000001;
        finalStatus = isFullRemainingRefund ? 'refunded' : 'partial_refunded';
        if (String(refundResult.status || '').toLowerCase() !== 'refunded') {
          mutationWarning = `渠道返回状态 ${String(refundResult.status || 'unknown')}，已按受理成功同步本地退款明细与库存`;
        }
        providerPayload = refundResult.data;
      } else {
        return json({ success: false, status: 'failed', error: '订单未记录支付渠道，无法退款' }, { status: 400 });
      }

      let orderDeleted = false;
      let remainingDiscountAmount = Number(order.total_discount_amount || 0);
      if (isRefundSuccess) {
        try {
          const mutationResult = await applyRetailRefundItemsFallback(env, order, orderItemIds, requesterUserId || merchantUserId || null);
          orderDeleted = Boolean(mutationResult?.order_deleted);
          const syncedOrderState = await syncRetailRefundOrderState(env, orderId);
          remainingDiscountAmount = Number(syncedOrderState?.remaining_discount_amount || mutationResult?.remaining_discount_amount || 0);
          finalStatus = String(syncedOrderState?.payment_status || mutationResult?.payment_status || (remainingDiscountAmount <= 0.000001 ? 'refunded' : 'partial_refunded'));
        } catch (error) {
          finalStatus = 'partial_refunded';
          mutationWarning = `退款已受理，但订单明细同步失败：${error instanceof Error ? error.message : 'unknown mutation error'}`;
          try {
            await patchOrderPayment(env, orderId, { payment_status: finalStatus });
          } catch (patchError) {
            mutationWarning = `${mutationWarning}；状态回写失败：${patchError instanceof Error ? patchError.message : 'unknown patch error'}`;
          }
        }
      } else {
        try {
          await patchOrderPayment(env, orderId, {
            payment_status: finalStatus,
          });
        } catch (patchError) {
          mutationWarning = `退款处理中，状态回写失败：${patchError instanceof Error ? patchError.message : 'unknown patch error'}`;
        }
      }

      if (isRefundSuccess) {
        try {
          await ensureRetailRefundFinanceRecords(env, order, {
            refundAmount,
            paymentMethod: String(order.payment_method || '').trim(),
            outTradeNo,
            refundNo,
            transactionId: order.payment_transaction_id || null,
            refundAt: new Date().toISOString(),
          });
        } catch (error) {
          mutationWarning = `${mutationWarning ? `${mutationWarning}；` : ''}退款自动冲减记账失败：${error instanceof Error ? error.message : 'unknown finance error'}`;
        }
      }

      try {
        await upsertPaymentEvent(env, {
          idempotency_key: buildPaymentEventKey({
            channel: order.payment_method,
            eventType: 'refund',
            outTradeNo,
            notifyId: refundNo,
            tradeNo: order.payment_transaction_id || null,
          }),
          channel: order.payment_method,
          out_trade_no: outTradeNo,
          transaction_id: order.payment_transaction_id || null,
          notify_id: null,
          event_type: 'refund',
          status: finalStatus,
          amount: refundAmount,
          processed: true,
          payload: {
            orderId,
            orderItemIds,
            refundedItems: refundedItemsSnapshot,
            provider: providerPayload,
            orderDeleted,
            remainingDiscountAmount,
          },
        });
      } catch (eventError) {
        mutationWarning = `${mutationWarning ? `${mutationWarning}；` : ''}退款事件写入失败：${eventError instanceof Error ? eventError.message : 'unknown event error'}`;
      }

      if (merchantUserId) {
        try {
          await insertNotification(env, {
            userId: merchantUserId,
            type: isRefundSuccess ? 'refund_completed' : 'refund_failed',
            orderId,
            message: isRefundSuccess
              ? `订单 #${orderId.slice(0, 8)} 退款已受理，金额 ¥${refundAmount.toFixed(2)}，状态 ${finalStatus}。`
              : `订单 #${orderId.slice(0, 8)} 退款申请提交后仍在处理，请稍后核对状态。`,
          });
        } catch (notifyError) {
          mutationWarning = `${mutationWarning ? `${mutationWarning}；` : ''}商户通知失败：${notifyError instanceof Error ? notifyError.message : 'unknown notify error'}`;
        }
      }

      if (requesterUserId && requesterUserId !== merchantUserId) {
        try {
          await insertNotification(env, {
            userId: requesterUserId,
            type: isRefundSuccess ? 'refund_approved' : 'refund_failed',
            orderId,
            message: isRefundSuccess
              ? `订单 #${orderId.slice(0, 8)} 的退款申请已由${order.payment_method === 'wechat' ? '微信' : '支付宝'}商户账号受理，当前状态：${finalStatus}。`
              : `订单 #${orderId.slice(0, 8)} 退款申请暂未完成，当前状态：${finalStatus}。`,
          });
        } catch (notifyError) {
          mutationWarning = `${mutationWarning ? `${mutationWarning}；` : ''}发起人通知失败：${notifyError instanceof Error ? notifyError.message : 'unknown notify error'}`;
        }
      }

      return json({
        success: true,
        status: finalStatus,
        orderId,
        refundAmount,
        orderDeleted,
        remainingDiscountAmount,
        refundedItemIds: orderItemIds,
        refundedItems: refundedItemsSnapshot,
        refundNo,
        warning: mutationWarning,
      });
      } catch (error) {
        return json({
          success: false,
          status: 'failed',
          error: `refund-items runtime error: ${error instanceof Error ? error.message : 'unknown error'}`,
        }, { status: 500 });
      }
    }

    if (url.pathname.startsWith('/api/payment/status/') && request.method === 'GET') {
      const orderId = url.pathname.split('/').pop();
      if (!orderId) return json({ error: 'missing order id' }, { status: 400 });

      if (isMock) {
        const state = mockStore.get(orderId);
        if (!state) return json({ status: 'failed' });
        return json({ status: state.status, transactionId: state.transactionId });
      }

      const order = await getOrderById(env, orderId);
      if (!order) return json({ status: 'failed', error: 'order not found' }, { status: 404 });
      const currentStatus = String(order.payment_status || '').toLowerCase();
      let financeWarning = null;

      if (currentStatus === 'paid' && order.payment_method) {
        try {
          await ensureRetailPaymentFinanceRecords(env, order, {
            amount: Number(order.payment_amount || order.total_retail_amount || 0),
            paymentMethod: String(order.payment_method || '').trim(),
            outTradeNo: order.payment_method === 'wechat' ? toWechatOutTradeNo(orderId) : orderId,
            transactionId: order.payment_transaction_id || null,
            paymentPaidAt: order.payment_paid_at || null,
          });
        } catch (error) {
          financeWarning = `支付状态已确认，但自动记账失败：${error instanceof Error ? error.message : 'unknown finance error'}`;
        }
      }

      if (currentStatus === 'refunded'
        || currentStatus === 'partial_refunded'
        || currentStatus === 'refund_pending'
        || currentStatus === 'partial_refund_pending') {
        return json({
          status: currentStatus,
          transactionId: order.payment_transaction_id || undefined,
          warning: financeWarning || undefined,
        });
      }
      if (order.payment_status === 'paid') {
        return json({
          status: 'paid',
          transactionId: order.payment_transaction_id || undefined,
          warning: financeWarning || undefined,
        });
      }

      if (order.payment_method === 'wechat') {
        const wechatOutTradeNo = toWechatOutTradeNo(orderId);
        const queryPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(wechatOutTradeNo)}?mchid=${encodeURIComponent(String(env.WECHAT_MCH_ID || '').trim())}`;
        let queryResult;
        try {
          queryResult = await postWechatRequest(env, 'GET', queryPath, null);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'wechat query failed';
          return json({ status: 'failed', error: `微信查单异常：${message}` }, { status: 500 });
        }
        const status = queryResult.ok ? queryResult.status : mapWechatErrorCodeToStatus(queryResult.code);
        const transactionId = queryResult.data?.transaction_id || null;
        const paymentPaidAt = status === 'paid' ? new Date().toISOString() : null;
        const queryAmount = Number.isFinite(Number(queryResult.data?.amount?.total))
          ? roundMoney(Number(queryResult.data.amount.total) / 100)
          : Number(order.payment_amount || order.total_retail_amount || 0);

        await patchOrderPayment(env, orderId, {
          payment_status: status,
          payment_transaction_id: transactionId,
          payment_paid_at: paymentPaidAt,
        });

        let queryFinanceWarning = null;
        if (status === 'paid') {
          try {
            await ensureRetailPaymentFinanceRecords(env, order, {
              amount: queryAmount,
              paymentMethod: 'wechat',
              outTradeNo: wechatOutTradeNo,
              transactionId,
              paymentPaidAt,
            });
          } catch (error) {
            queryFinanceWarning = `支付状态已确认，但自动记账失败：${error instanceof Error ? error.message : 'unknown finance error'}`;
          }
        }

        await upsertPaymentEvent(env, {
          idempotency_key: buildPaymentEventKey({
            channel: 'wechat',
            eventType: 'query',
            outTradeNo: wechatOutTradeNo,
            tradeNo: transactionId,
          }),
          channel: 'wechat',
          out_trade_no: wechatOutTradeNo,
          transaction_id: transactionId,
          notify_id: null,
          event_type: 'query',
          status,
          amount: Number(order.payment_amount || order.total_retail_amount || 0),
          processed: true,
          payload: queryResult.data || { code: queryResult.code, error: queryResult.error },
        });

        const queryError = (() => {
          if (queryResult.ok) return undefined;
          const code = String(queryResult.code || '').toUpperCase();
          const requestIdSuffix = queryResult.requestId ? `（Request-ID: ${queryResult.requestId}）` : '';
          if (code === 'SIGN_ERROR') {
            return `微信查单签名验证不通过，请核对 WECHAT_PRIVATE_KEY 与 WECHAT_SERIAL_NO${requestIdSuffix}`;
          }
          return `${queryResult.error || '微信查单失败'}${requestIdSuffix}`;
        })();

        return json({
          status,
          transactionId: transactionId || undefined,
          error: queryError,
          warning: queryFinanceWarning || undefined,
        });
      }

      const queryResult = await postAlipayRequest(env, 'alipay.trade.query', {
        out_trade_no: orderId,
      });

      if (!queryResult.ok) {
        return json({ status: 'failed', error: queryResult.error });
      }

      const status = parseTradeStatus(queryResult.data.trade_status);
      const paymentPaidAt = status === 'paid' ? new Date().toISOString() : null;
      await patchOrderPayment(env, orderId, {
        payment_status: status,
        payment_transaction_id: queryResult.data.trade_no || null,
        payment_paid_at: paymentPaidAt,
      });

      let queryFinanceWarning = null;
      if (status === 'paid') {
        try {
          await ensureRetailPaymentFinanceRecords(env, order, {
            amount: Number(queryResult.data.total_amount || order.payment_amount || order.total_retail_amount || 0),
            paymentMethod: 'alipay',
            outTradeNo: orderId,
            transactionId: queryResult.data.trade_no || null,
            paymentPaidAt,
          });
        } catch (error) {
          queryFinanceWarning = `支付状态已确认，但自动记账失败：${error instanceof Error ? error.message : 'unknown finance error'}`;
        }
      }

      await upsertPaymentEvent(env, {
        idempotency_key: buildPaymentEventKey({
          channel: 'alipay',
          eventType: 'query',
          outTradeNo: orderId,
          tradeNo: queryResult.data.trade_no,
        }),
        channel: 'alipay',
        out_trade_no: orderId,
        transaction_id: queryResult.data.trade_no || null,
        notify_id: null,
        event_type: 'query',
        status,
        amount: Number(queryResult.data.total_amount || 0),
        processed: true,
        payload: queryResult.data,
      });

      return json({
        status,
        transactionId: queryResult.data.trade_no,
        warning: queryFinanceWarning || undefined,
      });
    }

    if (url.pathname.startsWith('/api/payment/mock-success/') && request.method === 'POST') {
      const orderId = url.pathname.split('/').pop();
      if (!orderId) return json({ error: 'missing order id' }, { status: 400 });
      const existing = mockStore.get(orderId);
      if (!existing) return json({ error: 'not found' }, { status: 404 });
      mockStore.set(orderId, { ...existing, status: 'paid', transactionId: `mock_${Date.now()}` });
      return json({ success: true });
    }

    if (url.pathname === '/api/payment/wechat/notify' && request.method === 'POST') {
      try {
        const bodyText = await request.text();
        const timestamp = String(request.headers.get('Wechatpay-Timestamp') || '').trim();
        const nonce = String(request.headers.get('Wechatpay-Nonce') || '').trim();
        const signature = String(request.headers.get('Wechatpay-Signature') || '').trim();
        const serial = String(request.headers.get('Wechatpay-Serial') || '').trim();

        if (!timestamp || !nonce || !signature) {
          return wechatNotifyResponse('FAIL', 'missing signature headers', 400);
        }

        if (!env.WECHAT_PLATFORM_PUBLIC_KEY || !env.WECHAT_API_V3_KEY) {
          return wechatNotifyResponse('FAIL', 'missing wechat notify env', 500);
        }

        const verified = await verifyWechatNotifySignature({
          timestamp,
          nonce,
          bodyText,
          signature,
          publicKeyPem: env.WECHAT_PLATFORM_PUBLIC_KEY,
        });
        if (!verified) {
          return wechatNotifyResponse('FAIL', 'invalid signature', 400);
        }

        const payload = JSON.parse(bodyText || '{}');
        const decrypted = await decryptWechatNotifyResource(payload.resource, env.WECHAT_API_V3_KEY);

        const outTradeNo = String(decrypted.out_trade_no || '').trim();
        const resolvedOrderId = maybeUuidFromOutTradeNo(outTradeNo);
        const transactionId = String(decrypted.transaction_id || '').trim() || null;
        const tradeState = String(decrypted.trade_state || '').trim();
        const appid = String(decrypted.appid || '').trim();
        const mchid = String(decrypted.mchid || '').trim();
        const totalFen = Number(decrypted.amount?.total || 0);
        const totalAmount = Number((totalFen / 100).toFixed(2));
        const notifyId = String(payload.id || '').trim();

        if (!outTradeNo) {
          return wechatNotifyResponse('FAIL', 'missing out_trade_no', 400);
        }

        if (String(env.WECHAT_APP_ID || '').trim() && appid !== String(env.WECHAT_APP_ID || '').trim()) {
          return wechatNotifyResponse('FAIL', 'appid mismatch', 400);
        }
        if (String(env.WECHAT_MCH_ID || '').trim() && mchid !== String(env.WECHAT_MCH_ID || '').trim()) {
          return wechatNotifyResponse('FAIL', 'mchid mismatch', 400);
        }

        const status = parseWechatTradeStatus(tradeState);
        const idempotencyKey = buildPaymentEventKey({
          channel: 'wechat',
          eventType: 'notify',
          outTradeNo,
          notifyId,
          tradeNo: transactionId,
        });

        const existing = await getPaymentEventByKey(env, idempotencyKey);
        if (existing?.processed) {
          return wechatNotifyResponse('SUCCESS', 'OK', 200);
        }

        const order = await getOrderById(env, resolvedOrderId);
        if (!order) {
          await upsertPaymentEvent(env, {
            idempotency_key: idempotencyKey,
            channel: 'wechat',
            out_trade_no: outTradeNo,
            transaction_id: transactionId,
            notify_id: notifyId || serial || null,
            event_type: 'notify',
            status: 'failed',
            amount: totalAmount,
            processed: false,
            payload: { ...decrypted, reason: 'order_not_found' },
          });
          return wechatNotifyResponse('FAIL', 'order not found', 404);
        }

        const expectedAmount = Number(order.payment_amount || order.total_retail_amount || 0);
        if (!almostEqualAmount(expectedAmount, totalAmount)) {
          await upsertPaymentEvent(env, {
            idempotency_key: idempotencyKey,
            channel: 'wechat',
            out_trade_no: outTradeNo,
            transaction_id: transactionId,
            notify_id: notifyId || serial || null,
            event_type: 'notify',
            status: 'failed',
            amount: totalAmount,
            processed: false,
            payload: { ...decrypted, reason: 'amount_mismatch', expectedAmount },
          });
          return wechatNotifyResponse('FAIL', 'amount mismatch', 400);
        }

        const paymentPaidAt = status === 'paid' ? new Date().toISOString() : null;
        await patchOrderPayment(env, resolvedOrderId, {
          payment_method: 'wechat',
          payment_status: status,
          payment_amount: totalAmount,
          payment_transaction_id: transactionId,
          payment_paid_at: paymentPaidAt,
        });

        if (status === 'paid') {
          await ensureRetailPaymentFinanceRecords(env, order, {
            amount: totalAmount,
            paymentMethod: 'wechat',
            outTradeNo,
            transactionId,
            paymentPaidAt,
          });
        }

        await upsertPaymentEvent(env, {
          idempotency_key: idempotencyKey,
          channel: 'wechat',
          out_trade_no: outTradeNo,
          transaction_id: transactionId,
          notify_id: notifyId || serial || null,
          event_type: 'notify',
          status,
          amount: totalAmount,
          processed: true,
          payload: decrypted,
        });

        return wechatNotifyResponse('SUCCESS', 'OK', 200);
      } catch {
        return wechatNotifyResponse('FAIL', 'internal error', 500);
      }
    }

    if (url.pathname === '/api/payment/alipay/notify' && request.method === 'POST') {
      try {
        const bodyText = await request.text();
        const params = Object.fromEntries(new URLSearchParams(bodyText).entries());
        const sign = params.sign;
        const outTradeNo = params.out_trade_no;
        const tradeNo = params.trade_no;
        const notifyId = params.notify_id;
        const tradeStatus = params.trade_status;
        const totalAmount = Number(params.total_amount || 0);
        const appId = String(params.app_id || '');

        if (!sign || !outTradeNo || !env.ALIPAY_PUBLIC_KEY) {
          return new Response('failure', { status: 400 });
        }

        const signContent = buildAlipayVerifySignContent(params);
        const verified = await rsa2Verify(signContent, sign, env.ALIPAY_PUBLIC_KEY);
        if (!verified) {
          return new Response('failure', { status: 400 });
        }

        if (String(env.ALIPAY_APP_ID || '').trim() && appId !== String(env.ALIPAY_APP_ID).trim()) {
          return new Response('failure', { status: 400 });
        }

        const status = parseTradeStatus(tradeStatus);
        const idempotencyKey = buildPaymentEventKey({
          channel: 'alipay',
          eventType: 'notify',
          outTradeNo,
          notifyId,
          tradeNo,
        });

        const existing = await getPaymentEventByKey(env, idempotencyKey);
        if (existing?.processed) {
          return new Response('success', { status: 200 });
        }

        const order = await getOrderById(env, outTradeNo);
        if (!order) {
          await upsertPaymentEvent(env, {
            idempotency_key: idempotencyKey,
            channel: 'alipay',
            out_trade_no: outTradeNo,
            transaction_id: tradeNo || null,
            notify_id: notifyId || null,
            event_type: 'notify',
            status: 'failed',
            amount: totalAmount,
            processed: false,
            payload: { ...params, reason: 'order_not_found' },
          });
          return new Response('failure', { status: 404 });
        }

        const expectedAmount = Number(order.payment_amount || order.total_retail_amount || 0);
        if (!almostEqualAmount(expectedAmount, totalAmount)) {
          await upsertPaymentEvent(env, {
            idempotency_key: idempotencyKey,
            channel: 'alipay',
            out_trade_no: outTradeNo,
            transaction_id: tradeNo || null,
            notify_id: notifyId || null,
            event_type: 'notify',
            status: 'failed',
            amount: totalAmount,
            processed: false,
            payload: { ...params, reason: 'amount_mismatch', expectedAmount },
          });
          return new Response('failure', { status: 400 });
        }

        const paymentPaidAt = status === 'paid' ? new Date().toISOString() : null;
        await patchOrderPayment(env, outTradeNo, {
          payment_method: 'alipay',
          payment_status: status,
          payment_amount: totalAmount,
          payment_transaction_id: tradeNo || null,
          payment_paid_at: paymentPaidAt,
        });

        if (status === 'paid') {
          await ensureRetailPaymentFinanceRecords(env, order, {
            amount: totalAmount,
            paymentMethod: 'alipay',
            outTradeNo,
            transactionId: tradeNo || null,
            paymentPaidAt,
          });
        }

        await upsertPaymentEvent(env, {
          idempotency_key: idempotencyKey,
          channel: 'alipay',
          out_trade_no: outTradeNo,
          transaction_id: tradeNo || null,
          notify_id: notifyId || null,
          event_type: 'notify',
          status,
          amount: totalAmount,
          processed: true,
          payload: params,
        });

        return new Response('success', { status: 200 });
      } catch {
        return new Response('failure', { status: 500 });
      }
    }

    return json({ error: 'not found' }, { status: 404 });
    } catch (error) {
      return json({
        success: false,
        status: 'failed',
        error: `worker runtime error: ${error instanceof Error ? error.message : 'unknown error'}`,
      }, { status: 500 });
    }
  },
};
