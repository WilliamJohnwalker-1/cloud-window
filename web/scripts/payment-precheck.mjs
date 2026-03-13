const paymentApiUrl = String(process.env.PAYMENT_API_URL || 'https://pay.yunchuang888888.com').trim().replace(/\/$/, '');

const checkJsonEndpoint = async (path) => {
  const response = await fetch(`${paymentApiUrl}${path}`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`${path} 返回非 2xx：${response.status}`);
  }

  return response.json();
};

const run = async () => {
  try {
    const [health, config] = await Promise.all([
      checkJsonEndpoint('/health'),
      checkJsonEndpoint('/api/payment/config-check'),
    ]);

    if (!health.ok) {
      throw new Error('/health 返回 ok=false');
    }

    if (!config.ok) {
      throw new Error('/api/payment/config-check 返回 ok=false');
    }

    const mode = config.mock ? 'MOCK' : 'LIVE';
    const missing = Array.isArray(config.missing) ? config.missing : [];

    if (!config.mock && !config.liveReady) {
      throw new Error(`LIVE 配置未就绪，缺少变量：${missing.join(', ')}`);
    }

    process.stdout.write(`[payment-precheck] PASS endpoint=${paymentApiUrl} mode=${mode}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    process.stderr.write(`[payment-precheck] FAIL endpoint=${paymentApiUrl} reason=${message}\n`);
    process.exitCode = 1;
  }
};

void run();
