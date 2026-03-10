/* global Response, URL */

/**
 * Cloudflare Worker payment API (skeleton with mock mode).
 *
 * Production path:
 * 1) Replace the provider call sections with official WeChat/Alipay signing logic.
 * 2) Bind D1 as PAYMENT_DB and persist payment states.
 */

const mockStore = new Map();

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

    if (url.pathname === '/mobile/download/latest.apk' && request.method === 'GET') {
      if (!env.MOBILE_APK_BUCKET) {
        return json({ ok: false, error: 'R2 bucket not configured' }, { status: 500 });
      }

      const payload = getMobileLatestPayload(env);
      const objectKey = payload.androidApkKey || 'latest.apk';
      const object = await env.MOBILE_APK_BUCKET.get(objectKey);

      if (!object) {
        return json({ ok: false, error: 'APK not found in R2', key: objectKey }, { status: 404 });
      }

      const fileVersion = payload.latestVersion || 'latest';
      const fileName = `inventory-app-${fileVersion}.apk`;

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

    if (url.pathname.startsWith('/api/payment/status/') && request.method === 'GET') {
      const orderId = url.pathname.split('/').pop();
      if (!orderId) return json({ error: 'missing order id' }, { status: 400 });

      if (isMock) {
        const state = mockStore.get(orderId);
        if (!state) return json({ status: 'failed' });
        return json({ status: state.status, transactionId: state.transactionId });
      }

      return json({ status: 'pending' });
    }

    if (url.pathname.startsWith('/api/payment/mock-success/') && request.method === 'POST') {
      const orderId = url.pathname.split('/').pop();
      if (!orderId) return json({ error: 'missing order id' }, { status: 400 });
      const existing = mockStore.get(orderId);
      if (!existing) return json({ error: 'not found' }, { status: 404 });
      mockStore.set(orderId, { ...existing, status: 'paid', transactionId: `mock_${Date.now()}` });
      return json({ success: true });
    }

    return json({ error: 'not found' }, { status: 404 });
  },
};
