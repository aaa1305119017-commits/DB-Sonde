# 指标、看板与 ETL 接入

## 指标目录

指标定义保存在用户数据中，不随应用发布任何公司的指标或表名。指标中心支持导入 JSON：

```json
{"version":1,"id":"my-catalog-revision-1","metrics":[]}
```

`metrics` 使用 `src/features/metrics/metricsStore.ts` 的 `Metric` 结构。导入按稳定 `id` 去重，保留已有定义。可由用户放置 `semantic-catalog.json` 到应用配置目录，启动时按目录 `id` 一次导入；删除过的指标不会在每次启动时重新出现。连接绑定使用 DB Studio 已保存连接的 id。

普通指标使用 measure / ratio / derived / sql。多阶段计算可以使用 `template`，其 `queryPlan` 是声明式的 SQL、分子分母或维度分支结构；详细类型见 `queryPlan.ts`。表名、商户条件、维度表达式均属于导入数据。

SQL 模板输出 `value`，支持以下占位符：

| 占位符 | 用途 |
| --- | --- |
| `start`、`end` | 当前日期范围的 SQL 字面量 |
| `select` | 维度表达式与别名，含末尾逗号 |
| `groupBy` | 当前维度的 GROUP BY 子句 |
| `groupSuffix` | 接在已有 GROUP BY 列后的维度列表 |
| `names`、`groupNames` | 外层查询的维度列名和分组 |
| `filters` | 当前维度筛选条件，含前置 AND |

看板只引用指标中心的稳定标识。每次查询使用最新定义，按每个图表的实际分组重新聚合。KPI 使用汇总粒度。历史 SQL 看板仍可读取，新看板不再要求用户创建数据集。

## ETL 目录

在 ETL 中心选择“连接目录 / 自动识别”，填写本地或 SSH 目录。SSH 密码只在当次调用内使用，不保存到源配置。密钥认证复用系统 SSH；远端主机须已被系统 SSH 信任，远端需 Python 3.9+。

解析器只读取文件，不执行、导入或 source 其中的代码：

- DataX：reader / writer、所有 querySql、源库与目标库。
- SQL：多语句读写关系，排除 CTE 别名。
- Shell / Python：静态文件引用；Python 常量 SQL。
- 动态拼接 SQL、无法解析的变量、暂不支持的工具会显示待处理信息。

目录扫描跳过隐藏文件和目录、依赖目录、备份目录、before/after SQL 快照以及超过 1 MB 的文件；最多 2,000 个候选文件、60 秒。大仓库可分目录配置。

## 调度与血缘

DolphinScheduler 适配器通过 API 读取项目、工作流、任务定义、依赖、调度及运行记录。打开连接后自动同步各项目的定义。工作流与实例使用 code 关联，不通过名称前缀猜测。

文件目录显式关联一个调度连接。调度器和文件服务器路径不同时配置前缀映射。只接受精确路径、映射后的路径或唯一的路径后缀；同名且不唯一的文件保持未匹配。文件内部引用仅在目录清单中能确认时生成血缘节点。

任务、工作流、脚本、表、指标会进入同一图谱。任务状态来自任务实例，工作流状态来自工作流实例。多任务共同生产的表不显示一个虚假的单一运行结果，应查看其上游各任务。

新增工具在 ETL adapter 或 scheduler provider 接口实现解析能力；无需修改任何公司的业务定义。

## 验证

- `npm run test:integration`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
