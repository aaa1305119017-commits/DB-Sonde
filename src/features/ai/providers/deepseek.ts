import type { AiConfig, AiProvider } from "../aiTypes";
export const isDeepSeekPro = (model: string) => /^deepseek-v4-pro(?:-|$)/i.test(model);
export const isDeepSeekFlash = (model: string) => /^deepseek-(?:flash|v4-flash)(?:-|$)/i.test(model);
export const normalizeDeepSeekModel = (model: string) => /deepseek-(chat|reasoner|v4-flash)$/i.test(model) ? "deepseek-flash" : model;
/** Compatibility policy retained from saved analysis settings; isolated from workflow nodes. */
export function defaultDeepSeekAnalysis(config: AiConfig): {
    provider: AiProvider;
    model: string;
} | undefined {
    return /(^|[./-])deepseek/i.test(config.cloud.model) || /api\.deepseek\.com/.test(config.cloud.baseUrl)
        ? { provider: "cloud", model: "deepseek-flash" } : undefined;
}
export function applyDeepSeekVision(config: AiConfig, choice: {
    provider: AiProvider;
    model: string;
}): void {
    if ((isDeepSeekFlash(choice.model) || isDeepSeekPro(choice.model)) && !config.designVision)
        config.designVision = { enabled: true, provider: choice.provider, model: "deepseek-flash" };
    if (config.designVision?.model === "deepseek-v4-flash-vision-exp")
        config.designVision = { ...config.designVision, model: "deepseek-flash" };
}
