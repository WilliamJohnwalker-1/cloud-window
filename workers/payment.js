/* global Response, URL */

/**
 * Cloudflare Worker payment API (skeleton with mock mode).
 *
 * Production path:
 * 1) Replace the provider call sections with official WeChat/Alipay signing logic.
 * 2) Bind D1 as PAYMENT_DB and persist payment states.
 */

const mockStore = new Map();

const textEncoder = new TextEncoder();

function normalizePem(pem) {
  return String(pem || '').replace(/\\n/g, '\n').trim();
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

function buildAlipaySignContent(params) {
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

  const signContent = buildAlipaySignContent(requestParams);
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

function buildPaymentEventKey({ channel, eventType, outTradeNo, notifyId, tradeNo }) {
  return [channel, eventType, outTradeNo || '-', notifyId || '-', tradeNo || '-'].join(':');
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
    `/orders?id=eq.${encodeURIComponent(orderId)}&select=id,total_retail_amount,payment_amount,payment_status,payment_method,payment_transaction_id`,
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function patchOrderPayment(env, orderId, patch) {
  await supabaseRequest(env, `/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function getPaymentEventByKey(env, idempotencyKey) {
  const rows = await supabaseRequest(
    env,
    `/payment_events?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=id,processed`,
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
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

function getMobileLatestPayload(env) {
  const latestVersion = String(env.MOBILE_LATEST_VERSION || '').trim();
  const androidApkUrl = String(env.MOBILE_ANDROID_APK_URL || '').trim();

  return {
    latestVersion,
    androidApkUrl,
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

    if (url.pathname === '/health') {
      return json({ ok: true, mock: isMock, ts: Date.now() });
    }

    if (url.pathname === '/mobile/latest.json' && request.method === 'GET') {
      const payload = getMobileLatestPayload(env);
      const hasConfig = Boolean(payload.latestVersion && payload.androidApkUrl);
      return json(
        {
          ok: true,
          configured: hasConfig,
          ...payload,
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=60',
          },
        },
      );
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

      if (method === 'wechat') {
        return json({ error: 'wechat not implemented yet', status: 'failed' }, { status: 501 });
      }

      if (!/^\d{16,24}$/.test(authCode)) {
        return json({ error: 'invalid auth code', status: 'failed' }, { status: 400 });
      }

      if (isMock) {
        const transactionId = `mock_alipay_${Date.now()}`;
        mockStore.set(orderId, { status: 'paid', method, amount, transactionId, createdAt: Date.now() });
        return json({
          success: true,
          status: 'paid',
          orderId,
          outTradeNo: orderId,
          transactionId,
        });
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

      if (!alipayResult.ok) {
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
          payload: { error: alipayResult.error, code: alipayResult.code },
        });
        return json({ success: false, status: 'failed', error: alipayResult.error }, { status: 400 });
      }

      if (alipayResult.status === 'paid') {
        await patchOrderPayment(env, orderId, {
          payment_status: 'paid',
          payment_transaction_id: alipayResult.data.trade_no || null,
          payment_paid_at: new Date().toISOString(),
        });
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
      });
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
      if (order.payment_status === 'paid') {
        return json({ status: 'paid', transactionId: order.payment_transaction_id || undefined });
      }

      const queryResult = await postAlipayRequest(env, 'alipay.trade.query', {
        out_trade_no: orderId,
      });

      if (!queryResult.ok) {
        return json({ status: 'failed', error: queryResult.error });
      }

      const status = parseTradeStatus(queryResult.data.trade_status);
      await patchOrderPayment(env, orderId, {
        payment_status: status,
        payment_transaction_id: queryResult.data.trade_no || null,
        payment_paid_at: status === 'paid' ? new Date().toISOString() : null,
      });

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

      return json({ status, transactionId: queryResult.data.trade_no });
    }

    if (url.pathname.startsWith('/api/payment/mock-success/') && request.method === 'POST') {
      const orderId = url.pathname.split('/').pop();
      if (!orderId) return json({ error: 'missing order id' }, { status: 400 });
      const existing = mockStore.get(orderId);
      if (!existing) return json({ error: 'not found' }, { status: 404 });
      mockStore.set(orderId, { ...existing, status: 'paid', transactionId: `mock_${Date.now()}` });
      return json({ success: true });
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

        if (!sign || !outTradeNo || !env.ALIPAY_PUBLIC_KEY) {
          return new Response('failure', { status: 400 });
        }

        const signContent = buildAlipaySignContent(params);
        const verified = await rsa2Verify(signContent, sign, env.ALIPAY_PUBLIC_KEY);
        if (!verified) {
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
            processed: true,
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
            processed: true,
            payload: { ...params, reason: 'amount_mismatch', expectedAmount },
          });
          return new Response('failure', { status: 400 });
        }

        await patchOrderPayment(env, outTradeNo, {
          payment_method: 'alipay',
          payment_status: status,
          payment_amount: totalAmount,
          payment_transaction_id: tradeNo || null,
          payment_paid_at: status === 'paid' ? new Date().toISOString() : null,
        });

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
  },
};
