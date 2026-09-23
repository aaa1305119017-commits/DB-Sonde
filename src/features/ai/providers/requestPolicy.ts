import type { AiProvider } from "../aiTypes";
import { isDeepSeekFlash, isDeepSeekPro } from "./deepseek";
/** Provider wire extensions stay here; callers own messages, schemas, retries and cancellation. */
export function structuredRequestPolicy(provider: AiProvider, model: string, input: Record<string, unknown>, timeoutMs: number) {
    const body = { ...input };
    if (isDeepSeekPro(model)) {
        body.thinking = { type: "enabled" };
        body.reasoning_effort = "high";
        body.max_tokens = 32768;
        delete body.temperature;
        timeoutMs = 300000;
    }
    else if (isDeepSeekFlash(model)) {
        body.thinking = { type: "disabled" };
    }
    else if (provider === "local") {
        body.reasoning_effort = "none";
    }
    return { body, timeoutMs };
}
export function chatRequestExtensions(provider: AiProvider, thinkingEnabled: boolean): Record<string, unknown> {
    return provider === "local" ? {
        chat_template_kwargs: { enable_thinking: thinkingEnabled },
        ...(thinkingEnabled ? {} : { reasoning_effort: "none" }),
    } : {};
}
