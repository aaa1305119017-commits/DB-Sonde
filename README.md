# DB Sonde

一个桌面数据库客户端，外加一层指标 / 血缘 / AI 分析。Tauri 2 + Rust + React + TypeScript。

> [!WARNING]
> **这个项目几乎全部由 AI Agent 写成，bug 很多，请谨慎使用。**
>
> 它是一个人用 AI 编码代理一路做出来的自用工具，没有经过任何团队评审，也没有在
> 别人的环境里跑过。作者本人每天用它连生产库，但那不代表它对你也安全。
>
> 已知的现实：
> - 数据库客户端那部分（SQL 编辑器、表格、DDL、导出）相对稳，日常能用。
> - 指标 / 血缘 / AI 分析那部分是新东西，**没有前人**，问题集中在这里。
> - 只在 macOS (Apple Silicon) 上跑过。Windows / Linux 没测过。
> - 没有发布版本，没有签名证书，要用得自己从源码构建。
>
> **写操作请先在测试库上验证。** 表格编辑会直接 UPDATE 你的库。

## 它是什么

多数数据库客户端要服务所有人，所以只能停在「让你操作任何一个数据库」。
DB Sonde 反过来：支持的数据库少得多，但它知道你这些表背后是什么业务。

- **指标中心** —— 把「笔均金额 = 销售额 ÷ 订单量，按网点可加、跨店不可加」这类口径
  写成定义，看板、AI、查询都用同一份。改口径一处生效。
- **血缘** —— 从 ETL 作业、视图定义、指标口径和你粘的 SQL 里解析出表与表的上下游。
- **AI 分析** —— 说一句业务问题，它选指标、定范围、取数、自检数据、给结论、出看板。
  查不出来的会明说缺什么，不会编一个数顶上。
- 还有 SQL 编辑器、数据浏览与编辑、Python 工作台、DolphinScheduler 接入。

## 数据库支持

| 数据库 | 连接方式 | 手动事务 | 只读通道 |
| --- | --- | --- | --- |
| MySQL / MariaDB | SQLx 连接池 | 支持 | 支持 |
| PostgreSQL | SQLx 连接池 | 支持 | 支持 |
| SQLite | SQLx 连接池 | 支持 | 支持 |
| Oracle | 纯 Rust thin，可选 Instant Client thick | 不支持 | 不支持 |
| ClickHouse | HTTP / HTTPS | 不支持 | 不支持 |

PolarDB 的 MySQL 兼容实例按 MySQL 连。

## 构建

需要 Node.js、Rust 工具链和你平台上的 Tauri 构建依赖。

```sh
npm ci
npm run tauri dev          # 开发模式
npm run tauri build        # 打包
npm run install:local      # macOS：构建并装进 /Applications（不会自动关掉运行中的应用）
```

`npm run dev` 是纯浏览器预览，用的是模拟数据，不连真库。

签名走 `SONDE_SIGNING_IDENTITY`，没有就用本地临时签名。旧版本移进废纸篓备份。

## 测试

```sh
npm run check              # 全部前端与跨模块回归 + lint + tsc
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

`npm run check` 串了 50 来个守卫。它们不只测函数，也测架构约束
（比如 store 不许依赖 feature 模块）。改完代码建议做变异验证：
**故意把实现改错，看测试会不会挂** —— 这个项目里出过好几次
「改坏了测试照样全绿」，原因都是测试夹具的形状和真实数据对不上。

## 数据与凭据

- 数据库密码、AI 设置、调度平台凭据存在本地 AES-256-GCM 加密文件里，密钥只有当前
  系统用户可读写。连接配置本身不含密码。**这挡不住已经控制了你账户的进程。**
- 数据集预览、字段探测、AI 取数、Python `sonde.query` 走独立只读通道：
  MySQL / PostgreSQL 用只读事务，SQLite 用保守语句校验加最终回滚。
  普通 SQL 编辑器不受限制，你写什么就跑什么。
- 表格改单元格带完整主键和旧值做并发检查，批量失败回滚该批。
  MySQL 非事务表没有回滚保证；Oracle / ClickHouse 批量语句可能部分成功。
- 超出 JS 安全整数范围的整数和 DECIMAL 以字符串传输，避免主键和金额失真。
- Python 工作台限制在 `~/.sonde/workspace`，拒绝符号链接。但**它不是沙箱** ——
  你运行的脚本拥有你账户的全部权限。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/components`、`src/store` | 工作区界面、连接与编辑器状态 |
| `src/features` | 看板、数据集、指标、AI、分析、调度、血缘、ETL |
| `src/lib` | 共享的 SQL、日期、存储与接口边界 |
| `src-tauri/src/db` | 数据库驱动、元数据、事务、数据编辑 |
| `src-tauri/src/credentials.rs` | 本地加密凭据 |
| `scripts/test-*.mjs` | 前端与跨模块回归 |

## 许可证

MIT，见 [LICENSE](LICENSE)。第三方声明见 [NOTICE](NOTICE)。
