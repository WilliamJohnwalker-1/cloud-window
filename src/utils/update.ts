import Constants from 'expo-constants';

export const compareVersion = (current: string, target: string): number => {
  const normalize = (value: string): number[] => value
    .split('-')[0]
    .split('.')
    .map((item) => Number.parseInt(item, 10))
    .map((item) => (Number.isFinite(item) ? item : 0));

  const a = normalize(current);
  const b = normalize(target);
  const maxLen = Math.max(a.length, b.length);

  for (let i = 0; i < maxLen; i += 1) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }

  return 0;
};

export const resolveBinaryUpdateInfo = async (): Promise<{ latestVersion: string; androidApkUrl: string } | null> => {
  const binaryExtra = Constants.expoConfig?.extra?.binaryUpdate as {
    manifestUrl?: string;
    androidApkUrl?: string;
    androidApkVersion?: string;
  } | undefined;

  const manifestUrl = binaryExtra?.manifestUrl?.trim();
  const paymentApiBaseUrl = process.env.EXPO_PUBLIC_PAYMENT_API_URL?.trim();
  const effectiveManifestUrl = manifestUrl
    || (paymentApiBaseUrl ? `${paymentApiBaseUrl.replace(/\/$/, '')}/mobile/latest.json` : '');
  const fallbackApkUrl = binaryExtra?.androidApkUrl?.trim();
  const fallbackApkVersion = binaryExtra?.androidApkVersion?.trim();

  if (effectiveManifestUrl) {
    const response = await fetch(effectiveManifestUrl);
    if (!response.ok) {
      throw new Error(`二进制更新清单请求失败（${response.status}）`);
    }

    const data = await response.json() as {
      latestVersion?: string;
      androidApkUrl?: string;
    };

    const latestVersion = data.latestVersion?.trim();
    const androidApkUrl = data.androidApkUrl?.trim();
    if (latestVersion && androidApkUrl) {
      return { latestVersion, androidApkUrl };
    }
  }

  if (fallbackApkUrl && fallbackApkVersion) {
    return {
      latestVersion: fallbackApkVersion,
      androidApkUrl: fallbackApkUrl,
    };
  }

  return null;
};
