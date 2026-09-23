/**
 * 横向虚拟化:算出「现在该画哪几列」。
 *
 * 交叉表按原始日期铺开一整年、再乘十几个指标,就是一千多列。全都塞进 DOM 的话,
 * 十几行也有上万个单元格 —— 首次渲染要好几秒,之后在看板上改任何东西都得跟着它重来一遍,
 * 打字都一顿一顿。但列数本身不该限制:那是人家的数据,少给一列都是错的。
 * 所以列照旧全算出来,只是画视口里那些,两边各垫一个占位单元格把宽度补上,
 * 横向滚动条的长度和位置跟全量渲染完全一致。
 *
 * 列宽是确定的(选项里给了,或者按类型取默认值),所以不用测量 DOM 就能算出每列的位置。
 */

export interface ColumnWindow {
  /** 要渲染的列下标区间 [from, to)。冻结列不在里面,它们永远渲染。 */
  from: number;
  to: number;
  /** 左右两个占位单元格的宽度,用来顶住滚动条。 */
  padLeft: number;
  padRight: number;
}

/**
 * @param widths      所有列的宽度(含冻结列)
 * @param frozenCount 前几列是冻结的 —— 它们浮在左边,永远画
 * @param scrollLeft  横向滚动位置
 * @param viewport    可视宽度
 * @param overscan    视口外多画几屏,滚动时不至于看见空白
 */
export function columnWindow(
  widths: number[],
  frozenCount: number,
  scrollLeft: number,
  viewport: number,
  overscan = 600,
): ColumnWindow {
  const total = widths.length;
  if (total <= frozenCount) return { from: frozenCount, to: total, padLeft: 0, padRight: 0 };

  /* 视口宽度还没量到(首次渲染、或者表还没上屏)时别瞎猜:先全画出来。
     猜一个小值会导致第一帧只画几列,量到之后再补,看着就是闪一下。 */
  if (viewport <= 0) return { from: frozenCount, to: total, padLeft: 0, padRight: 0 };

  // 冻结列浮在左边挡住内容,所以可视区其实从「滚动位置 + 冻结宽度」开始。
  let frozenWidth = 0;
  for (let i = 0; i < frozenCount; i += 1) frozenWidth += widths[i];
  const start = scrollLeft + frozenWidth - overscan;
  const end = scrollLeft + viewport + overscan;

  let from = frozenCount;
  let to = total;
  let padLeft = 0;
  let padRight = 0;
  let x = frozenWidth;
  let found = false;

  for (let i = frozenCount; i < total; i += 1) {
    const right = x + widths[i];
    if (right <= start) {
      padLeft += widths[i];
      x = right;
      continue;
    }
    if (!found) { from = i; found = true; }
    if (x >= end) {
      to = i;
      for (let j = i; j < total; j += 1) padRight += widths[j];
      return { from, to, padLeft, padRight };
    }
    x = right;
  }
  if (!found) {
    // 滚到了所有列的右边(可能是列被删了),退回最后一屏,别留一片空白。
    return { from: frozenCount, to: total, padLeft: 0, padRight: 0 };
  }
  return { from, to, padLeft, padRight };
}
