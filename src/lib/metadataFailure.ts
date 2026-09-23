/**
 * 一部分元数据取不到时,给一句能动手的话 —— 而不是把驱动原话甩出来。
 *
 * 起因是一个真实的视图:打开它整页只剩
 * `1267 (HY000): Illegal mix of collations (utf8mb4_unicode_ci,COERCIBLE)
 *  and (utf8mb4_0900_ai_ci,COERCIBLE) for operation '='`。
 *
 * 这条报错**不是工具的问题,是那个视图自己的定义有问题**:查 information_schema
 * 的列时 MySQL 要先解析视图体,而视图里比较了两个排序规则不同的字段
 * (老表多是 utf8mb4_unicode_ci,MySQL 8 新建的是 utf8mb4_0900_ai_ci)。
 * 直接查这个视图会报一模一样的错。
 *
 * 分不清这一点的人会以为是客户端坏了,去重装、去换工具 —— 所以这句必须说清:
 * 谁坏了、为什么、以及去哪儿看(DDL 还在,SHOW CREATE VIEW 不执行视图体)。
 */

/** 四份元数据的下标,和调用处的顺序一致。 */
export const METADATA_PARTS = ["列", "索引", "DDL", "对象信息"] as const;

export function explainMetadataFailure(failed: number[], reason: string, objectKind?: string): string {
  const missing = failed.map((i) => METADATA_PARTS[i] ?? "").filter(Boolean).join("、");
  const isView = (objectKind ?? "").toLowerCase() === "view";
  const head = `${missing}没能取到,其余照常显示。`;

  if (/Illegal mix of collations/i.test(reason)) {
    return head +
      (isView
        ? "数据库说这个视图里比较了两个**排序规则不同**的字段(常见于老表 utf8mb4_unicode_ci" +
          " 和 MySQL 8 新建的 utf8mb4_0900_ai_ci 混用)。这是视图定义本身的问题 —— " +
          "直接 SELECT 这个视图会报同样的错。看下面的 DDL 找到那个 JOIN/WHERE 的比较," +
          "给其中一边加 COLLATE,或者把两张底表的排序规则统一。"
        : "数据库说有两个**排序规则不同**的字段在做比较。给其中一边加 COLLATE,或统一底表的排序规则。") +
      `\n数据库原话:${reason}`;
  }
  return `${head}\n数据库原话:${reason}`;
}
