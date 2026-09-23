# DB Sonde

一个桌面数据库客户端，外加一层指标 / 血缘 / AI 分析。Tauri 2 + Rust + React + TypeScript。

> [!NOTE]
> **这个项目是怎么做出来的**
>
> 代码大量借助 AI Coding Agent 实现。需求定义、产品设计、架构取舍、指标口径规则、
> 测试验证和长期维护由作者负责 —— 包括 `npm run check` 里那 50 来套守卫，以及
> 「故意把实现改坏、看测试会不会挂」的验证习惯（见[测试](#测试)），它们正是为了
> 兜住这种协作方式的下限。

> [!WARNING]
> **当前是 Beta。写操作请先在测试库上验证 —— 表格编辑会直接 UPDATE 你的库。**
>
> - 数据库客户端那部分（SQL 编辑器、表格、DDL、导出）相对稳，日常能用。
> - 指标 / 血缘 / AI 分析那部分是新东西，**没有前人**，问题集中在这里。
> - 只在 macOS (Apple Silicon) 上跑过，Windows / Linux 没测过；尚未在作者以外的
>   环境中验证。
> - 提供 macOS 安装包；当前没有 Apple 开发者签名和公证，首次打开需系统确认。

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

## 下载安装（macOS）

**[下载 DB Sonde 0.51.13 · M 系列 Mac 安装包](https://github.com/aaa1305119017-commits/DB-Sonde/releases/download/v0.51.13/DB-Sonde_0.51.13_macOS_arm64.dmg)**

1. 下载并双击打开 `.dmg`。
2. 把 **DB Sonde** 拖进旁边的 **Applications（应用程序）**。
3. 从“应用程序”打开 **DB Sonde**。

不需要安装 Homebrew、Node、Rust，也不用运行命令或编译源码。
首次打开是空连接列表，可手动创建本地 SQLite 演示库体验。

安装包适用于 Apple Silicon（M 系列芯片），建议 macOS 14 或更新版本。当前版本未经过
Apple 签名公证；如果首次打开被系统拦截，在 **系统设置 → 隐私与安全性 → 仍要打开**
中允许 DB Sonde。参见 [Apple 官方说明](https://support.apple.com/102445)。

这是基础安装包：数据库客户端和云端 AI 接口可用，本地 AI 与 Python 运行时未内置。
安装包校验值和版本说明见 [下载页](https://github.com/aaa1305119017-commits/DB-Sonde/releases/tag/v0.51.13)。

## 从源码构建（开发者）

需要 Node.js、Rust 工具链和你平台上的 Tauri 构建依赖。

```sh
npm ci
npm run tauri dev          # 开发模式
npm run tauri build        # 打包
npm run package:mac        # Apple Silicon：生成可分发 DMG，包含许可文件和 SHA-256 校验值
npm run install:local      # macOS：构建并装进 /Applications（不会自动关掉运行中的应用）
```

`npm run dev` 是纯浏览器预览，用的是模拟数据，不连真库。

开源版使用独立的应用标识 `com.u35.dbsonde`，不会读取或迁移旧 Sonde
（`com.u35.sonde`）的连接、凭据和工作区。开发运行与打包安装遵循相同规则：
首次打开连接列表为空，添加连接后也只在手动点击连接时连库；重启或恢复页面不会自动连接。
macOS 配置目录为 `~/Library/Application Support/com.u35.dbsonde/`，
本地模型、Python 运行时和脚本工作区存放在 `~/.db-sonde/`。

### 在 macOS 上从源码安装

目前只验证过 Apple Silicon（M 系列芯片）。以下使用 Homebrew，适用于 macOS 14 及更新版本。

1. 打开终端，安装 Xcode Command Line Tools，并等待安装完成：

   ```sh
   xcode-select --install
   ```

2. 按 [Homebrew 官网](https://brew.sh/)安装 Homebrew，执行安装完成后显示的
   `Next steps`，然后安装构建工具：

   ```sh
   brew install node rust
   ```

3. 下载源码并安装应用：

   ```sh
   git clone https://github.com/aaa1305119017-commits/DB-Sonde.git
   cd DB-Sonde
   npm ci
   npm run install:local
   ```

   首次编译耗时较长。成功后应用位于 `/Applications/DB Sonde.app`，以后可从“应用程序”打开：

   ```sh
   open "/Applications/DB Sonde.app"
   ```

首次打开应显示空连接列表。可以手动创建本地 SQLite 演示库体验功能，或添加自己的数据库；
演示库不会连接外部服务器。基础安装不包含本地 AI 模型和 Python 运行时，按下一节自行添加。

平台依赖说明见 [Tauri macOS 构建前置条件](https://v2.tauri.app/start/prerequisites/#macos)。

### 可选的内置运行时

本地 AI（llama.cpp）和 Python 工作台需要两份体积较大的运行时，它们不在仓库里，
**不装也能正常构建**，只是这两个功能不可用：

```sh
scripts/bundle-llama.sh     # 需要先 brew install llama.cpp
scripts/bundle-python.sh
```

跑完这两个脚本，`npm run install:local` 会自动把它们打包进去。直接用
`npm run tauri build` 的话，加上 `-- --config tauri.bundled.conf.json`。

不装的后果：AI 面板里本地模型会提示 `llama-server not found`，Python 工作台
提示「这个安装包没有内置 Python 运行时」。AI 面板改用云端模型（DeepSeek /
OpenAI 兼容接口）不受影响。

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
- Python 工作台限制在 `~/.db-sonde/workspace`，拒绝符号链接。但**它不是沙箱** ——
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
