# 用 openpyxl 把上一步写出来的文件真读一遍 —— 自己拼的 zip/XML,只有被真正的
# Excel 解析器读过才算数。读不出来这儿会直接抛。
import sys
from openpyxl import load_workbook

path = sys.argv[1]
wb = load_workbook(path)
ws = wb.active
assert ws.title == "明细表", f"工作表名不对: {ws.title}"
rows = list(ws.iter_rows(values_only=True))
assert rows[0] == ("网点大区", "统计日期", "总GMV", "订单量"), f"表头不对: {rows[0]}"
assert rows[1] == ("西北大区", "2026-01-01", 2629.58, 131), f"第一行不对: {rows[1]}"
assert rows[2][2] == -13794.5, "负数要原样写进去"
assert rows[3][0] == '华南"引号"大区', f"引号被吃了: {rows[3][0]}"
assert rows[4][0] == "含<标签>&符号", f"XML 转义有问题: {rows[4][0]}"
assert rows[4][2] is None, "空值就该是空的,不是 0"
# 数字得是真数字,不是看着像数字的文本 —— 否则 Excel 里求和排序全废
assert isinstance(rows[1][2], float), f"总GMV 应该是数字: {type(rows[1][2])}"
assert isinstance(rows[1][3], int), f"订单量 应该是整数: {type(rows[1][3])}"
assert ws.freeze_panes == "A2", f"表头没冻结: {ws.freeze_panes}"
assert ws.auto_filter.ref, "没有自动筛选"
assert ws.cell(1, 1).font.bold, "表头没加粗"
assert ws.cell(2, 3).number_format == "#,##0.00", f"两位小数的格式没带上: {ws.cell(2,3).number_format}"
assert ws.cell(2, 4).number_format == "#,##0", f"整数列的格式没带上: {ws.cell(2,4).number_format}"
print(f"verify-xlsx: openpyxl 读通了,{ws.max_row} 行 × {ws.max_column} 列,12 项检查通过")
