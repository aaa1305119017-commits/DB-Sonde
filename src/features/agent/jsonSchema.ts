/**
 * 够用的 JSON Schema 子集 —— Tool 入参校验和模型结构化输出共用一套。
 *
 * 为什么不引 ajv:这里只需要 OpenAI `response_format.json_schema` 支持的那个子集
 * (object/array/string/number/integer/boolean + enum/required/additionalProperties
 * + 少量 pattern 和范围),ajv 会拖进 100KB+ 和一个代码生成器,而当前 bundle 已经
 * 在报 chunk size 警告。
 *
 * 关键设计:**错误信息是写给 LLM 看的**。
 * "$.dateRange.start: 期望 YYYY-MM-DD 格式,得到 \"上个月\"" 能让模型自己改对;
 * "invalid" 只能触发一次无脑重试。所以每条错误都带路径、期望、实得。
 */

export type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  description?: string;
  enum?: readonly unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  /** 正则源码(字符串,便于整体 JSON 序列化后发给模型)。 */
  pattern?: string;
  /** 人话的格式说明,拼进错误信息里给模型看。 */
  patternHint?: string;
};

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

const show = (v: unknown): string => {
  const text = typeof v === "string" ? JSON.stringify(v) : String(v);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

/** 校验一个值。返回空数组 = 通过。 */
export function validate(value: unknown, schema: JsonSchema, path = "$"): string[] {
  const errors: string[] = [];
  const actual = typeOf(value);

  if (schema.type) {
    const ok =
      schema.type === "integer"
        ? typeof value === "number" && Number.isInteger(value)
        : schema.type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : actual === schema.type;
    // 类型就不对,再往下查子字段只会刷屏,直接返回
    if (!ok) return [`${path}: 期望 ${schema.type},得到 ${actual}(${show(value)})`];
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: 必须是 ${show(schema.const)},得到 ${show(value)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: 只能是 ${schema.enum.map(show).join(" / ")} 之一,得到 ${show(value)}`);
  }

  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: ${schema.patternHint ?? `需匹配 ${schema.pattern}`},得到 ${show(value)}`);
    }
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path}: 至少 ${schema.minLength} 个字符,得到 ${value.length} 个`);
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push(`${path}: 最多 ${schema.maxLength} 个字符,得到 ${value.length} 个`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: 不能小于 ${schema.minimum},得到 ${value}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: 不能大于 ${schema.maximum},得到 ${value}`);
  }

  if (actual === "object" && schema.properties) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record) || record[key] === undefined) {
        const hint = schema.properties[key]?.description;
        errors.push(`${path}.${key}: 缺失${hint ? `(${hint})` : ""}`);
      }
    }
    for (const [key, child] of Object.entries(record)) {
      const sub = schema.properties[key];
      if (!sub) {
        if (schema.additionalProperties === false) {
          const allowed = Object.keys(schema.properties).join(" / ");
          errors.push(`${path}.${key}: 不认识的字段,只接受 ${allowed}`);
        }
        if (typeof schema.additionalProperties === "object") errors.push(...validate(child, schema.additionalProperties, `${path}.${key}`));
        continue;
      }
      if (child === undefined) continue; // 可选字段给了 undefined 等于没给
      errors.push(...validate(child, sub, `${path}.${key}`));
    }
  }

  if (actual === "array") {
    const list = value as unknown[];
    if (schema.minItems != null && list.length < schema.minItems) {
      errors.push(`${path}: 至少 ${schema.minItems} 项,得到 ${list.length} 项`);
    }
    if (schema.maxItems != null && list.length > schema.maxItems) {
      errors.push(`${path}: 最多 ${schema.maxItems} 项,得到 ${list.length} 项`);
    }
    if (schema.items) list.forEach((item, i) => errors.push(...validate(item, schema.items!, `${path}[${i}]`)));
  }

  return errors;
}

/** 常用片段,省得到处重写。 */
export const S = {
  str: (description?: string): JsonSchema => ({ type: "string", description }),
  date: (description?: string): JsonSchema => ({
    type: "string",
    description,
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    patternHint: "需要 YYYY-MM-DD 格式的确定日期,不能写「上个月」这类相对说法",
  }),
  int: (description?: string, minimum?: number, maximum?: number): JsonSchema => ({ type: "integer", description, minimum, maximum }),
  bool: (description?: string): JsonSchema => ({ type: "boolean", description }),
  enumOf: <T extends string>(values: readonly T[], description?: string): JsonSchema => ({ type: "string", enum: values, description }),
  /** 数组一定要给 maxItems:json_schema 模式下上限是靠语法约束住解码的,
   *  不给上限时模型可能陷入重复循环、把同一项吐十几遍直到撞 max_tokens 被截断,
   *  最后得到一段断在半截的 JSON。真机上就是这么挂的。 */
  arr: (items: JsonSchema, description?: string, maxItems = 20, minItems?: number): JsonSchema => ({
    type: "array", items, description, maxItems, minItems,
  }),
  record: (items: JsonSchema, description?: string): JsonSchema => ({ type: "object", properties: {}, additionalProperties: items, description }),
  obj: (properties: Record<string, JsonSchema>, required: readonly string[] = [], description?: string): JsonSchema => ({
    type: "object",
    description,
    properties,
    required,
    additionalProperties: false,
  }),
};
