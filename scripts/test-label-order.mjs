// 分类轴(饼图就是扇区)的排列顺序。用户原话:「换个图表就不支持排序了?不合理吧」——
// 以前只有表格能排,折线图另有一个藏在样式面板里的「时间顺序」,条形图和饼图什么都没有。
// 现在三种图和表格读同一处设置、走同一份实现(labelOrder.runtime.js),导出的页面也用它。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 跟它在浏览器里被内联执行时一个样:普通脚本,挂到 window 上。
new Function(readFileSync('src/features/dashboard/labelOrder.runtime.js', 'utf8'))();
const { orderLabels, orderSpecOf } = globalThis.__DASH_ORDER__;

const widget = (type, options = {}) => ({ type, options: { topN: 0, ...options } });
const gmv = { '西北大区': 300, '华东大区': 100, '华南大区': 200 };
const all = ['西北大区', '华东大区', '华南大区'];
const valueOf = (l) => gmv[l];

// 没设就保持取数回来的顺序 —— 别自作主张重排
assert.deepEqual(orderLabels(all, { dimension: '', metric: null }), all, '没设排序就别动顺序');

// 维度升降序:中文按拼音
assert.deepEqual(
  orderLabels(all, { dimension: 'asc', metric: null }),
  ['华东大区', '华南大区', '西北大区'], '按拼音升序');
assert.deepEqual(
  orderLabels(all, { dimension: 'desc', metric: null }),
  ['西北大区', '华南大区', '华东大区'], '按拼音降序');

// 数字要按大小排,不是按字符串 —— 否则「10月」会排在「2月」前面
assert.deepEqual(
  orderLabels(['10月', '2月', '1月'], { dimension: 'asc', metric: null }),
  ['1月', '2月', '10月'], '数字按大小排,不是按字符串');

// 指标升降序
assert.deepEqual(
  orderLabels(all, { dimension: '', metric: { dir: 'desc', valueOf } }),
  ['西北大区', '华南大区', '华东大区'], '按指标降序');
assert.deepEqual(
  orderLabels(all, { dimension: '', metric: { dir: 'asc', valueOf } }),
  ['华东大区', '华南大区', '西北大区'], '按指标升序');

// 算不出来的值(比如平均值没法汇总)排到最后,别让 NaN 把整个顺序搅乱
assert.deepEqual(
  orderLabels(all, { dimension: '', metric: { dir: 'desc', valueOf: (l) => (l === '华南大区' ? NaN : gmv[l]) } }),
  ['西北大区', '华东大区', '华南大区'], '算不出来的排最后');

// 指标排序优先于维度排序:用户挑了「按总GMV降序」,那就是他要的
assert.deepEqual(
  orderLabels(all, { dimension: 'asc', metric: { dir: 'desc', valueOf } }),
  ['西北大区', '华南大区', '华东大区'], '指标排序优先');

// ── 从组件配置里读排序意图 ────────────────────────────────────────────────
const sorts = { table: { dimensionSorts: { region: 'desc' } } };
for (const type of ['table', 'line', 'bar', 'pie']) {
  const spec = orderSpecOf(widget(type, sorts), 'region', ['field:amount']);
  assert.equal(spec.dimension, 'desc', `${type} 也要认这份排序 —— 换个图表类型排序不能丢`);
}

// 指标排序:指着的指标还在才算数
const withMetric = { table: { metricSort: { key: 'field:amount', dir: 'asc' } } };
assert.deepEqual(
  orderSpecOf(widget('bar', withMetric), 'region', ['field:amount']),
  { dimension: '', metricKey: 'field:amount', dir: 'asc' }, '条形图按指标排');
assert.equal(
  orderSpecOf(widget('bar', withMetric), 'region', ['field:orders']).metricKey, null,
  '排序指着的指标已经不在了,就当没设 —— 别拿一个查不到值的 key 去排');

/* 时间轴不能按数值排。用户原话:「降序 升序 他的时间根本就不对」—— 把月份按 GMV
   从小到大摞一遍,折线看上去一路上涨,其实什么也不表示,x 轴还是乱的
   (2026-09 排在 2026-02 前面)。想看排名换条形图。 */
const timeSort = { table: { metricSort: { key: 'field:amount', dir: 'asc' } } };
assert.equal(
  orderSpecOf(widget('line', timeSort), 'stat_date', ['field:amount'], true).metricKey, null,
  '时间轴不认指标排序');
assert.equal(
  orderSpecOf(widget('line', timeSort), 'stat_date', ['field:amount'], true).dimension, 'asc',
  '时间轴默认按时间先后');
assert.equal(
  orderSpecOf(widget('bar', timeSort), 'region', ['field:amount'], false).metricKey, 'field:amount',
  '不是时间轴的照常按指标排');
// 时间轴上显式选了降序还是要认 —— 挡的只是「按数值排」
assert.equal(
  orderSpecOf(widget('line', { table: { dimensionSorts: { stat_date: 'desc' } } }), 'stat_date', [], true).dimension,
  'desc', '时间轴上选了倒序还是倒序');

// 「组内」是表格才有的层次(要有上层分组),图表只有一层分类轴,当普通升降序
assert.equal(
  orderSpecOf(widget('bar', { table: { dimensionSorts: { region: 'group_asc' } } }), 'region', []).dimension,
  'asc', '图表上「组内升序」按普通升序处理');

// 老看板里折线图的「时间顺序」是单独一个样式选项,要继续读得到
assert.equal(
  orderSpecOf(widget('line', { chart: { lineTimeOrder: 'desc' } }), 'stat_date', []).dimension,
  'desc', '老看板存的 lineTimeOrder 还要认');
assert.equal(
  orderSpecOf(widget('line', { chart: { lineTimeOrder: 'desc' }, table: { dimensionSorts: { stat_date: 'asc' } } }), 'stat_date', []).dimension,
  'asc', '新设的以新的为准');
// 只有折线图有过这个选项,别让它泄到别的图上
assert.equal(
  orderSpecOf(widget('bar', { chart: { lineTimeOrder: 'desc' } }), 'stat_date', []).dimension,
  '', 'lineTimeOrder 只对折线图兼容');

// 不改入参
const input = ['b', 'a'];
orderLabels(input, { dimension: 'asc', metric: null });
assert.deepEqual(input, ['b', 'a'], '排序不该改调用方的数组');

console.log('label order: 22 assertions passed');
