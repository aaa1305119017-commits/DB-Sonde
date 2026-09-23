/**
 * 关联字段自动推断。
 *
 * 建关联最烦的一步是从两串字段里翻出该对上的那两个,而绝大多数关联就是同名字段
 * 或者「xxx_id 对 id」。这里把它猜出来,人只需要看一眼对不对 —— 猜错了点一下就能改,
 * 但不该让每次都从零开始选。
 *
 * 只按名字猜,不看数据:探测字段已经跑过一次查询,再为猜关联跑一次不值当。
 */

/** 归一化:忽略大小写和下划线,`StoreID` / `store_id` / `storeid` 视为同一个。 */
const norm = (name: string) => name.toLowerCase().replace(/[_\s-]/g, "");

export interface JoinGuess {
  field: string;
  targetField: string;
  /** 怎么猜出来的,界面上写给人看。 */
  reason: string;
}

/**
 * 在两张表的字段里找最可能的关联对。
 *
 * 按把握从高到低:同名的 id 字段 → 同名字段 → 「表名_id」对上目标表的主键样字段。
 * 都不像就返回空,让人自己选 —— 胡乱猜一个比不猜更糟,它看起来是对的。
 */
export function guessJoin(
  fields: string[],
  targetFields: string[],
  targetTable?: string,
): JoinGuess | undefined {
  const target = new Map(targetFields.map((name) => [norm(name), name]));

  const sameName = fields.filter((name) => target.has(norm(name)));
  const idLike = sameName.filter((name) => /id$|code$|no$|key$/i.test(name));
  if (idLike.length) {
    return { field: idLike[0], targetField: target.get(norm(idLike[0]))!, reason: "同名主键字段" };
  }
  if (sameName.length) {
    return { field: sameName[0], targetField: target.get(norm(sameName[0]))!, reason: "同名字段" };
  }

  // 「store_id」对上 store 表的「id」
  if (targetTable) {
    const stem = norm(targetTable.replace(/^(t_|dim_|dwd_|dws_|ods_|ads_)/i, ""));
    const foreign = fields.find((name) => {
      const n = norm(name);
      return n !== stem && n.startsWith(stem) && /id$|code$|no$/.test(n);
    });
    const primary = targetFields.find((name) => ["id", "code", "no"].includes(norm(name)))
      ?? targetFields.find((name) => norm(name) === `${stem}id`);
    if (foreign && primary) return { field: foreign, targetField: primary, reason: `${targetTable} 的主键` };
  }
  return undefined;
}
