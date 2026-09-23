/* 环形图的几何 —— 内外半径和外置标签的排版。
 *
 * 一份实现两处用:看板 import 它,导出的离线网页把同一个文件内联进去。
 * 之前是三处各算一遍(pieRadii 算内外圈、pieOuterRadius 又去收外圈、导出端再内联抄一份),
 * 于是收外圈的那个不知道内圈是多少 —— 模型把内圈设成 55、外圈 75 本来是个 20 单位厚的环,
 * 被收到 56 之后剩 1 个单位,画出来就是一条细线圈,看着像"饼图没数据"。
 */
(function () {
  /**
   * 外置标签的排版。标签画在饼外面,不收着点就会被卡片边缘切掉
   * (见过「河…9…」这种:名字和百分比各被切掉一半,看不出是哪个大区)。
   *
   * alignTo:"edge" 把标签贴着容器边排,给定宽度 + break 让长名字换行而不是一直往外顶;
   * hideOverlap 宁可少画几个也不让它们叠在一起。
   */
  var PIE_LABEL = {
    label: { alignTo: "edge", edgeDistance: 6, width: 78, overflow: "break", lineHeight: 15 },
    labelLine: { length: 10, length2: 8, maxSurfaceAngle: 80 },
    labelLayout: { hideOverlap: true },
    /** 显示外置标签时,饼本身最多占到多少 —— 余下的留给标签和引导线。 */
    outerWithLabels: 56,
  };

  var num = function (value, fallback) {
    return typeof value === "number" && isFinite(value) ? value : fallback;
  };

  /**
   * 环形的内外半径(百分比)。
   *
   * @param inner       用户设的内半径,不填 42
   * @param outer       用户设的外半径,不填 75
   * @param showLabels  要不要给外置标签腾地方
   *
   * 收外圈时内圈**按同比例跟着收** —— 这是关键:只收外圈的话,内外之差被吃掉,
   * 环就成了一条线。内圈最多顶到外圈减 1,保证始终是个环而不是实心饼或一条线。
   */
  function pieRadii(inner, outer, showLabels) {
    var full = Math.max(20, Math.min(95, num(outer, 75)));
    var hole = Math.max(0, Math.min(full - 1, num(inner, 42)));
    if (!showLabels || full <= PIE_LABEL.outerWithLabels) return [hole, full];
    var shrunk = PIE_LABEL.outerWithLabels;
    return [Math.max(0, Math.min(shrunk - 1, Math.round((hole * shrunk) / full))), shrunk];
  }

  globalThis.__DASH_PIE__ = { PIE_LABEL: PIE_LABEL, pieRadii: pieRadii };
})();
