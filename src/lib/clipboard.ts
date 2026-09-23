import { inTauri } from "./mockBackend";

/**
 * 剪贴板读写。
 *
 * WKWebView(Tauri 桌面端)里 `navigator.clipboard.readText()` 会被拒绝
 * (NotAllowedError)——Safari 系对"读"剪贴板管得很严。所以桌面端一律走
 * Tauri 官方 clipboard-manager 插件(原生读取,不弹授权);浏览器/dev 环境
 * 才回落到 Web API。读不到就返回空串,调用方自行降级。
 */
export async function readClipboardText(): Promise<string> {
  if (inTauri) {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return (await readText()) ?? "";
    } catch {
      /* 插件不可用时继续尝试 Web API */
    }
  }
  try {
    return (await navigator.clipboard?.readText?.()) ?? "";
  } catch {
    return "";
  }
}

export async function tryWriteClipboardText(text: string): Promise<boolean> {
  if (inTauri) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch {
      /* 继续尝试 Web API */
    }
  }
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Compatibility wrapper for existing best-effort copy actions. */
export async function writeClipboardText(text: string): Promise<void> {
  await tryWriteClipboardText(text);
}
