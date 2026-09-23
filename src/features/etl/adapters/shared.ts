import type { Endpoint } from "../types";

/* 各家 ETL 适配器共用的那几件事。
 *
 * 抽出来的理由很实际:jdbcUrl 解析原来长在 datax.ts 里,而 Kettle 和 Sqoop 同样
 * 要从 jdbcUrl 里抠 host 和库名。各抄一份的话,以后加一种数据库的 URL 格式
 * (比如 SQL Server 的 `;databaseName=` 写法)就得改三个地方,漏一个的表现是
 * 「这个源的库名是空的」,而没人会想到是适配器之间走散了。 */

/**
 * 从 jdbcUrl 里抠出 host:port 和库名。**不碰用户名口令** —— 那些在别的字段里,
 * 抠进来会顺着血缘图一路显示出去。
 *
 * 认得出这几种写法:
 *   jdbc:mysql://host:3306/db?useSSL=false
 *   jdbc:postgresql://host:5432/db
 *   jdbc:oracle:thin:@//host:1521/service   和   @host:1521:sid
 *   jdbc:sqlserver://host:1433;databaseName=db
 *   jdbc:hive2://host:10000/db
 * 认不出来就返回空 —— 宁可少填一个字段,也别把一段乱码当库名显示出来。
 * host 里带 ${...} / {{...}} 占位符的(配置里常见)按"没有"处理。
 */
export function parseJdbc(url: string): { host?: string; database?: string } {
  if (typeof url !== "string") return {};
  // Oracle 两种写法都要:@//host:port/service 和 @host:port:sid
  const ora = url.match(/@\/?\/?([^/:\s]+:\d+)[/:]([\w$.]+)/);
  if (/oracle/i.test(url) && ora) return { host: ora[1], database: ora[2] };
  // SQL Server 把库名写在分号参数里,不在路径上
  if (/sqlserver/i.test(url)) {
    const host = url.match(/\/\/([^/;\s]+)/);
    const db = url.match(/[;&]\s*databaseName\s*=\s*([^;&\s]+)/i);
    return { host: placeholderFree(host?.[1]), database: db?.[1] };
  }
  // jdbc:<engine>://<authority>/<db>?... —— authority 里可能是占位符
  const m = url.match(/\/\/([^/]+)\/([^/?;&]+)/);
  if (m) return { host: placeholderFree(m[1]), database: m[2] || undefined };
  // 只有 authority、没有库名(比如 jdbc:mysql://host:3306)
  const hostOnly = url.match(/\/\/([^/?;\s]+)\s*$/);
  if (hostOnly) return { host: placeholderFree(hostOnly[1]) };
  return {};
}

/**
 * 把 jdbcUrl 里的凭据抹掉,留下能看的部分。
 *
 * 这个 URL 会作为 `detail` 存进作业、显示在血缘图的悬停提示上。而 jdbcUrl 里
 * **是可以带口令的**:`jdbc:mysql://h/db?user=root&password=xxxx`、
 * `jdbc:postgresql://user:pw@host/db`。原样存下去等于把生产库口令写进了
 * 一份会被导出、会进知识库的文档里。
 *
 * 只抹,不丢 —— host 和库名还得看得见,那是血缘的一部分。
 */
export function redactJdbc(url: string): string {
  if (typeof url !== "string" || !url) return url;
  return url
    // //user:pw@host → //host
    .replace(/\/\/[^/@\s]*:[^/@\s]*@/, "//")
    // ?user=x&password=y 这类参数里的敏感项
    .replace(/([?;&])\s*(password|passwd|pwd|user|username|uid|token|secret|accessKey|accessKeyId|accessKeySecret)\s*=[^&;\s]*/gi,
      (_m, sep: string, key: string) => `${sep}${key}=***`);
}

/** 配置里 host 常写成 ${DB_HOST} 这种占位符,那不是主机名,别当真。 */
function placeholderFree(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /\$\{|\{\{|%[A-Za-z_]/.test(value) ? undefined : value;
}

/** 可能是单个、可能是数组、可能没有 —— 统一成数组。 */
export const arr = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** 一个端点在界面上怎么称呼它。 */
export const endpointLabel = (e: Endpoint): string =>
  e.table || e.path || (e.querySql ? "查询" : e.system) || "?";

/**
 * 给作业起个名字:「源 → 目标」。
 *
 * 优先用两边的表名 —— 那是人一眼能对上的东西;源常常是一段 SELECT(没有表名),
 * 这时候只用目标表名。两边都没有就退回端点的称呼。
 * 三个适配器共用同一套命名,列表里才不会一半是「a → b」一半是别的样子。
 */
export function nameJob(sources: Endpoint[], targets: Endpoint[], fallback?: string): string {
  const target = targets.find((e) => e.table) ?? targets[0];
  const source = sources.find((e) => e.table);
  if (target?.table) return source?.table ? `${source.table} → ${target.table}` : target.table;
  if (!sources.length && !targets.length) return fallback || "作业";
  return `${sources[0] ? endpointLabel(sources[0]) : "源"} → ${targets[0] ? endpointLabel(targets[0]) : "目标"}`;
}
