import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../../lib/mockBackend";

interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
}

/** Perform an HTTP request through the Rust proxy (dodges webview CORS +
 *  self-signed TLS). Scheduler providers build their calls on top of this. */
export async function schedulerFetch(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutSecs?: number;
  /** 这个地址允许自签证书吗。不传 = 不允许(正常校验)。 */
  allowInvalidCerts?: boolean;
}): Promise<HttpResponse> {
  if (!inTauri) throw new Error("调度接入需在桌面版(Tauri)中运行");
  return invoke<HttpResponse>("scheduler_fetch", {
    request: {
      method: opts.method,
      url: opts.url,
      headers: opts.headers ?? {},
      body: opts.body ?? null,
      timeoutSecs: opts.timeoutSecs ?? null,
      allowInvalidCerts: opts.allowInvalidCerts ?? false,
    },
  });
}

export function formEncode(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}
