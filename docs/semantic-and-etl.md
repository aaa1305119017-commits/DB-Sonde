# 指标、看板与 ETL 接入

## 指标目录

指标中心支持导入 JSON 目录：

```json
{"version":1,"id":"my-catalog-revision-1","name":"示例目录","metrics":[]}
```

`metrics` 使用 [`Metric`](../src/features/metrics/metricTypes.ts) 结构，连接通过已保存连接的 ID 绑定。
导入默认保留同 ID 的已有指标，也可选择覆盖；不同目录不能互相覆盖重复的指标 ID。

指标类型包括 `measure`、`ratio`、`derived`、`sql` 和 `template`。
多阶段计算使用声明式 `queryPlan`，类型见 [`queryPlan.ts`](../src/features/metrics/queryPlan.ts)。
指标中的 SQL 必须符合目标数据库方言。

SQL 模板输出 `value`，支持以下占位符：

| 占位符 | 用途 |
| --- | --- |
| `start`、`end` | 当前日期范围的 SQL 字面量 |
| `select` | 维度表达式与别名，含末尾逗号 |
| `groupBy` | 当前维度的 GROUP BY 子句 |
| `groupSuffix` | 接在已有 GROUP BY 列后的维度列表 |
| `names`、`groupNames` | 外层查询的维度列名和分组 |
| `filters` | 当前维度筛选条件，含前置 AND |

看板通过稳定 ID 引用指标，按图表的实际分组重新聚合。KPI 使用汇总粒度。
修改指标定义时，应检查依赖该指标的图表和分析结果。

## ETL 文件目录

在 ETL 中心选择“连接目录 / 自动识别”，填写本地或 SSH 目录。
SSH 密码仅用于当次调用；密钥认证复用系统 SSH。远端主机须已被系统 SSH 信任，并安装 Python 3.9 或更新版本。

文件解析采用静态读取，不执行扫描到的脚本：

- DataX：reader / writer、querySql、源库与目标库。
- SQL：多语句读写关系，排除 CTE 别名。
- Shell / Python：静态文件引用及 Python 常量 SQL。
- 动态拼接 SQL、无法解析的变量和不支持的格式显示为待处理信息。

扫描跳过隐藏目录、依赖和备份目录，以及超过 1 MB 的文件；最多扫描 2,000 个候选文件，限时 60 秒。
大型目录可拆分为多个接入源。

## 通用 JSON 导入

通用适配器支持作业数组或 `{ "jobs": [...] }`。
字段不同的外部文件可配置 JSON Pointer 映射。例如输入：

```json
{"tasks":[{"code":"stock-sync","title":"库存同步","inputs":[{"schema":"erp","relation":"stock"}],"outputs":[{"schema":"mart","relation":"inventory"}]}]}
```

对应映射：

```json
{"jobs":"/tasks","id":"/code","name":"/title","sources":"/inputs","targets":"/outputs","endpoint":{"database":"/schema","table":"/relation"}}
```

映射随接入源保存，不执行表达式或外部脚本。重复作业标识、无效路径和缺失端点会报告错误。
该入口不依赖 Python、SSH 或调度服务。

## 调度与血缘

DolphinScheduler 适配器通过 API 获取项目、工作流、任务定义、依赖、调度和运行记录。
工作流与实例使用 code 关联。

文件目录可关联调度连接，并配置调度路径到文件目录的前缀映射。
只有精确路径、映射后的路径或唯一的路径后缀才会匹配；同名且不唯一的文件保持未匹配。

任务、工作流、脚本、表和指标在同一图谱中展示。
任务状态来自任务实例，工作流状态来自工作流实例；多个任务共同生成的表需分别查看上游任务状态。

扩展解析器和调度器的入口见 [模块结构与开发约定](architecture.md#etl-与调度)。
