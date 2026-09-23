import { create } from "zustand";
import { localDayIn, utcDay } from "../../lib/dates";
export const useDailyReport = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/** Business dates use the configured service time zone; old services retain their original default. */
export function defaultReportWindow(now = new Date(), timeZone = "Asia/Shanghai"): { start: string; end: string } {
  const today = Date.parse(`${localDayIn(timeZone, now)}T00:00:00Z`);
  return { start: utcDay(new Date(today - 7 * 86400000)), end: utcDay(new Date(today - 86400000)) };
}

/** Migrate earlier SSH preferences without retaining any credential fields. */
export function reportServiceSource(value: unknown): { url: string } | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  let address = typeof saved.url === "string" ? saved.url.trim() : "";
  if (!address && typeof saved.host === "string" && saved.host.trim()) {
    const host = saved.host.trim();
    address = `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:8765`;
  }
  try {
    const url = new URL(address);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return { url: url.origin };
  } catch { return null; }
}
