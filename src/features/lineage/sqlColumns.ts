/** SQL 列名的粗解析 —— 纯函数,不碰任何 store(好让集成测试能直接 import)。 */

const KEYWORDS = new Set([
  "select","from","where","group","order","by","having","join","left","right","inner","outer","on","as","and","or","not","in","is","null","case","when","then","else","end","sum","count","avg","min","max","round","cast","date","distinct","union","all","with","over","partition","row_number","ifnull","coalesce","nullif","limit","desc","asc","between","like","now","interval","day","month","year","true","false","int","decimal","varchar","exists",
]);

/** SQL 里出现过的词(小写、去关键字)—— 当作"这段逻辑碰过哪些列/表"的词表。 */
export function sqlVocab(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const w = m[0].toLowerCase();
    if (w.length >= 3 && !KEYWORDS.has(w)) out.add(w);
  }
  return out;
}

/** 一段 SELECT 产出的列名:`AS 别名` + 裸列名。宁可多收(多收只会少剪)。 */
/** CAST(x AS DECIMAL(10,2)) 里的 DECIMAL 不是列名。 */
const SQL_TYPES = new Set([
  "decimal","numeric","signed","unsigned","char","nchar","varchar","binary","integer","int","bigint","double","float","real","date","datetime","time","timestamp","json","text","boolean",
]);

export function outputColumns(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/\bAS\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/gi)) {
    const c = m[1].toLowerCase();
    if (!SQL_TYPES.has(c)) out.add(c);
  }
  // 没有别名的裸列:SELECT a.stat_date, store_id, ...
  const head = /\bSELECT\b([\s\S]*?)\bFROM\b/i.exec(sql);
  if (head) {
    for (const piece of head[1].split(",")) {
      const m = /^\s*(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*$/.exec(piece);
      if (m && !KEYWORDS.has(m[1].toLowerCase())) out.add(m[1].toLowerCase());
    }
  }
  return out;
}


/** SQL 里 FROM / JOIN 到的表(带库名的优先),用于给作业标出"它从哪读"。 */
export function sqlSourceTables(sql: string): string[] {
  const ctes = new Set([...sql.matchAll(/\b([A-Za-z_]\w*)\s+AS\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const out: string[] = [];
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+`?([A-Za-z_]\w*)`?(?:\.`?([A-Za-z_]\w*)`?)?/gi)) {
    const name = (m[2] ? `${m[1]}.${m[2]}` : m[1]).toLowerCase();
    const bare = m[2] ? m[2].toLowerCase() : m[1].toLowerCase();
    if (ctes.has(bare) || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

/**
 * 某个指标用到了某张表的哪些字段。
 * 先在 SQL 里找这张表被起了什么别名(`FROM shop_ads.ads_outlet_daily a`),
 * 再把 `a.xxx` 收集起来 —— 比全文抓所有 `x.y` 准得多,不会把 JOIN 进来的维表字段
 * 算到这张表头上。
 */
export function fieldsUsedOn(sql: string, tableId: string): string[] {
  const bare = (tableId.split(".").pop() ?? tableId).replace(/[^A-Za-z0-9_]/g, "");
  if (!bare) return [];
  const aliases = new Set<string>();
  for (const m of sql.matchAll(new RegExp(`\\b(?:FROM|JOIN)\\s+\`?(?:[A-Za-z_]\\w*\`?\\.\`?)?${bare}\`?\\s+(?:AS\\s+)?\`?([A-Za-z_]\\w*)\`?`, "gi"))) {
    const a = m[1].toLowerCase();
    if (!["on", "where", "group", "order", "join", "left", "inner", "using", "set"].includes(a)) aliases.add(a);
  }
  const cols = new Set<string>();
  for (const a of aliases) {
    for (const m of sql.matchAll(new RegExp(`\\b${a}\\.\`?([A-Za-z_]\\w*)\`?`, "gi"))) cols.add(m[1].toLowerCase());
  }
  return [...cols].sort();
}
