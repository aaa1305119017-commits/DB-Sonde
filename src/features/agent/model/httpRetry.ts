/** Only explicit transient HTTP failures are replayed; schema repair has a separate budget. */
export class ModelHttpError extends Error {
  constructor(readonly status: number, readonly detail: string, retries: number) {
    const reason = status === 429 ? '模型服务请求过多' : status >= 500 ? `模型服务暂时异常（HTTP ${status}）` : `模型请求失败（HTTP ${status}）`;
    super(`${reason}${retries ? `，已自动重试 ${retries} 次` : ''}。${status === 401 || status === 403 ? '请检查模型服务的密钥和权限。' : status >= 500 || status === 429 ? '请稍后重试。' : detail}`);
    this.name = 'ModelHttpError';
  }
}
const transient = new Set([408, 429, 500, 502, 503, 504]);
export function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export function createHttpRetry(port: { wait?: typeof waitForRetry; now?: () => number; random?: () => number; } = {}) {
  let retries = 0;
  const wait = port.wait ?? waitForRetry;
  return async (request: () => Promise<Response>, signal?: AbortSignal) => {
    while (true) {
      signal?.throwIfAborted();
      const response = await request();
      signal?.throwIfAborted();
      if (response.ok) return response;
      const detail = (await response.text()).slice(0, 200);
      signal?.throwIfAborted();
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const requestedDelay = retryAfter === null ? 0 : Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryAfter) - (port.now ?? Date.now)());
      // Long server cooldowns are surfaced immediately instead of silently holding the task.
      if (!transient.has(response.status) || retries >= 2 || requestedDelay > 30000) throw new ModelHttpError(response.status, detail, retries);
      const backoff = 1000 * 2 ** retries + (port.random ?? Math.random)() * 250;
      retries++;
      await wait(Math.max(backoff, requestedDelay || 0), signal);
    }
  };
}
