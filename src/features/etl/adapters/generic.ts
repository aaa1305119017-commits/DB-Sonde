import type { Endpoint, EtlAdapter, EtlJob, EtlFieldMapping } from "../types";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, label: string): string => {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${label}必须是非空文本`);
    return value;
};
/** RFC 6901 pointers only: no evaluated expressions, scripts, or guessed paths. */
export function atPointer(value: unknown, pointer: string): unknown {
    if (pointer === "")
        return value;
    if (typeof pointer !== "string" || !pointer.startsWith("/"))
        throw new Error(`字段路径必须以 / 开头：${pointer}`);
    return pointer.slice(1).split("/").reduce<unknown>((current, part) => {
        const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
        return current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, key)
            ? (current as Record<string, unknown>)[key] : undefined;
    }, value);
}
function endpoints(value: unknown, label: string, mapping?: EtlFieldMapping["endpoint"]): Endpoint[] {
    if (!Array.isArray(value))
        throw new Error(`${label}必须是数组；没有端点时填写 []`);
    return value.map((raw, index) => {
        if (!record(raw))
            throw new Error(`${label}[${index}] 必须是端点对象`);
        const input = mapping ? Object.fromEntries(Object.entries(mapping).map(([key, path]) => [key, atPointer(raw, path)])) : raw;
        const kind = input.kind ?? (input.table ? "db" : input.path ? "file" : "unknown");
        if (kind !== "db" && kind !== "file" && kind !== "unknown")
            throw new Error(`${label}[${index}] 端点类型无效`);
        // Whitelist metadata. Unrecognized properties, including credentials, never enter persisted state.
        const endpoint: Endpoint = { kind };
        for (const field of ["system", "host", "database", "table", "querySql", "path", "detail"] as const) {
            if (input[field] !== undefined && input[field] !== null)
                endpoint[field] = string(input[field], `${label}.${field}`);
        }
        if (kind === "db" && !endpoint.table && !endpoint.querySql)
            throw new Error(`${label}的数据库端点缺少表或查询`);
        if (kind === "file" && !endpoint.path)
            throw new Error(`${label}的文件端点缺少路径`);
        return endpoint;
    });
}
export function parseGenericJobs(text: string, mapping?: EtlFieldMapping): EtlJob[] {
    if (mapping) {
        if (!record(mapping) || ["jobs", "id", "name", "sources", "targets"].some(key => typeof mapping[key as keyof EtlFieldMapping] !== "string"))
            throw new Error("字段映射需包含 jobs、id、name、sources、targets 五条文本路径");
        if (mapping.endpoint && !record(mapping.endpoint))
            throw new Error("端点映射必须是字段到路径的对象");
    }
    const document: unknown = JSON.parse(text);
    const rows = mapping ? atPointer(document, mapping.jobs) : Array.isArray(document) ? document : record(document) ? document.jobs : undefined;
    if (!Array.isArray(rows))
        throw new Error("未找到作业数组，请检查作业路径或输入内容");
    const ids = new Set<string>();
    return rows.map((raw, index) => {
        if (!record(raw))
            throw new Error(`第 ${index + 1} 个作业必须是对象`);
        const value = (field: "id" | "name" | "sources" | "targets" | "schedule" | "references") => mapping ? mapping[field] === undefined ? undefined : atPointer(raw, mapping[field]!) : raw[field];
        const idValue = value("id");
        const id = string(typeof idValue === "number" && Number.isSafeInteger(idValue) ? String(idValue) : idValue, "作业标识");
        if (ids.has(id))
            throw new Error(`作业标识重复：${id}`);
        ids.add(id);
        const job: EtlJob = { id, name: string(value("name"), "作业名称"), kind: "generic",
            sources: endpoints(value("sources"), "来源", mapping?.endpoint), targets: endpoints(value("targets"), "目标", mapping?.endpoint) };
        const schedule = value("schedule");
        if (schedule != null)
            job.schedule = string(schedule, "调度说明");
        const references = value("references");
        if (references != null) {
            if (!Array.isArray(references))
                throw new Error("脚本引用必须是数组");
            job.references = references.map(ref => string(ref, "脚本引用"));
        }
        if (!mapping) {
            if (raw.note != null)
                job.note = string(raw.note, "备注");
            if (raw.flows != null) {
                if (!Array.isArray(raw.flows))
                    throw new Error("数据流必须是数组");
                job.flows = raw.flows.map(flow => {
                    if (!record(flow))
                        throw new Error("数据流必须是对象");
                    return { sources: endpoints(flow.sources, "数据流来源"), targets: endpoints(flow.targets, "数据流目标") };
                });
            }
            if (raw.scheduler != null) {
                if (!record(raw.scheduler))
                    throw new Error("调度元数据必须是对象");
                const s = raw.scheduler;
                if (!Array.isArray(s.upstreamTaskCodes))
                    throw new Error("上游任务标识必须是数组");
                job.scheduler = { baseUrl: string(s.baseUrl, "调度地址"), projectCode: string(s.projectCode, "项目标识"), workflowCode: string(s.workflowCode, "工作流标识"), workflowName: string(s.workflowName, "工作流名称"), taskCode: string(s.taskCode, "任务标识"), upstreamTaskCodes: s.upstreamTaskCodes.map(code => string(code, "上游任务标识")) };
            }
        }
        return job;
    });
}
export const genericAdapter: EtlAdapter = {
    kind: "generic", label: "通用作业", available: true, supportsMapping: true,
    blurb: "导入作业元数据；可映射现有 JSON 字段，无需改动外部 ETL 或目录。",
    inputHint: "粘贴作业 JSON", parse: parseGenericJobs,
    example: '[{"id":"daily-orders","name":"订单同步","sources":[{"kind":"db","database":"source","table":"orders"}],"targets":[{"kind":"db","database":"warehouse","table":"orders"}]}]',
};
