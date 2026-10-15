const DEFAULT_ERROR_MESSAGE_ZH = '操作失败，请稍后重试';

const ERROR_MESSAGE_MAPPING: Array<{ matcher: RegExp; message: string }> = [
  { matcher: /network request failed|failed to fetch|network error|connection refused|timeout/i, message: '网络连接失败，请检查网络后重试' },
  { matcher: /invalid login credentials/i, message: '账号或密码错误，请重新输入' },
  { matcher: /email not confirmed/i, message: '邮箱尚未验证，请先完成邮箱验证' },
  { matcher: /user already registered|already been registered/i, message: '该邮箱已注册，请直接登录' },
  { matcher: /password should be at least/i, message: '密码长度不足，请至少输入 6 位' },
  { matcher: /invalid refresh token|refresh token not found|token refresh failed/i, message: '登录状态已失效，请重新登录' },
  { matcher: /jwt expired|invalid jwt|token is expired/i, message: '登录已过期，请重新登录' },
  { matcher: /permission denied|not allowed|forbidden|insufficient privilege/i, message: '权限不足，无法执行当前操作' },
  { matcher: /duplicate key value/i, message: '数据重复，请检查后重试' },
  { matcher: /violates.*constraint/i, message: '数据不符合规则，请检查输入后重试' },
  { matcher: /row-level security|rls/i, message: '当前账号无权访问该数据，请联系管理员' },
  { matcher: /does not exist|not found/i, message: '目标数据不存在或已被删除，请刷新后重试' },
];

const sanitizeRawMessage = (raw: string): string => {
  return raw
    .replace(/^Auth(Api)?Error:\s*/i, '')
    .replace(/^PostgrestError:\s*/i, '')
    .replace(/^TypeError:\s*/i, '')
    .trim();
};

export const getErrorMessageZh = (error: unknown, fallback = DEFAULT_ERROR_MESSAGE_ZH): string => {
  if (!error) return fallback;

  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : '';

  const message = sanitizeRawMessage(rawMessage);
  if (!message) return fallback;

  if (/^[\u4e00-\u9fa5，。！？、：“”‘’（）【】《》；：\s\dA-Za-z%+\-_/().,:'"!]+$/.test(message) && /[\u4e00-\u9fa5]/.test(message)) {
    return message;
  }

  const matched = ERROR_MESSAGE_MAPPING.find((item) => item.matcher.test(message));
  if (matched) return matched.message;

  return fallback;
};
