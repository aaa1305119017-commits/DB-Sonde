import type { ConnectionConfig } from "../types";

export function databaseBrand(config: ConnectionConfig, serverVersion = ""): string {
  const selected = config.brand?.toLowerCase() ?? "";
  const signature = selected || serverVersion.toLowerCase();
  for (const brand of ["polardb", "opengauss", "gaussdb", "kingbase", "greenplum", "oceanbase", "starrocks", "doris", "tidb", "mariadb"]) {
    if (signature.includes(brand)) return brand;
  }
  return config.kind;
}

/** Saved accents win; stable fallback does not change on disconnect/reorder. */
export function connectionAccent(config: ConnectionConfig): string {
  if (config.color) return config.color;
  let hash = 0;
  for (const c of config.id) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
  return `hsl(${((hash >>> 0) * 137.508) % 360} 62% 62%)`;
}

/**
 * 品牌 → 徽标上的一两个字母。
 *
 * 取代厂商 logo(见 DatabaseLogo 的注释:那些是别人的注册商标,
 * MIT 授不出去)。规则是人一眼能对上的缩写,而不是机械截前两位 ——
 * PostgreSQL 写 PG、ClickHouse 写 CH,才认得出来。
 */
const INITIALS: Record<string, string> = {
  mysql: "My", mariadb: "Ma", postgres: "PG", oracle: "Or", sqlite: "SQ",
  clickhouse: "CH", doris: "Do", tidb: "Ti", oceanbase: "OB", starrocks: "SR",
  kingbase: "KB", gaussdb: "GS", greenplum: "GP", opengauss: "oG", polardb: "PL",
};

export function brandInitials(brand: string): string {
  return INITIALS[brand] ?? brand.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}
