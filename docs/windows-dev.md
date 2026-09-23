# 在 Windows 上开发 DB Sonde

这份文档记的是**实际踩过的坑**，不是通用的环境搭建教程。每一条都有具体现象，
因为它们的共同点是：**报错信息和真实原因隔得很远**，不知道的话会往错误方向查很久。

按 [Tauri 的前置要求](https://v2.tauri.app/start/prerequisites/) 装完 Node、Rust、
MSVC 之后，下面这些是你还会撞上的。

---

## 构建

### MSVC 只装 Build Tools 外壳是不够的

Visual Studio Installer 装完显示「Visual Studio 生成工具 2022」已安装，但**默认不勾任何
工作负载**。`VC\Tools\MSVC\<版本>` 目录会存在（里面有 `crt`/`include`/`lib`），
但没有 `bin`，也就没有 `cl.exe` 和 `link.exe`。

Rust 这时报的是：

```
error: linker `link.exe` not found
note: VS Code is a different product, and is not sufficient
```

要在安装器里点 **修改** → 勾 **使用 C++ 的桌面开发**。

判断装没装好，别看目录在不在，直接找编译器：

```powershell
Get-ChildItem -Recurse -Filter cl.exe 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\'
```

> `dir /s /b "...\*\bin\Hostx64\x64\cl.exe"` 在 cmd 里对带空格的路径加通配符会解析失败，
> 报「文件名、目录名或卷标语法不正确」——**看起来像没装，其实是命令错了**。用 PowerShell。

### 安全软件会拦编译产物

360 安全卫士的主动防御（`ZhuDongFangYu.exe`）会拦**刚编译出来、立刻被执行**的
可执行文件。cargo 编译构建脚本后马上运行它，正好撞上：

```
error: failed to run custom build command for `quote v1.0.47`
  could not execute process `...\build-script-build` (never executed)
  拒绝访问。 (os error 5)
```

注意这**不是**权限问题：目录 ACL 正常，把 `whoami.exe` 拷进去照样能跑，手动执行那个
被拒的 `build-script-build.exe` 也能跑——只有「新文件 + 立即执行」这个组合被拦。

把这两个目录加进安全软件的信任区：

- 你的工作目录
- `%USERPROFILE%\.cargo`

Windows Defender 同理，用 `Add-MpPreference -ExclusionPath`。

---

## 测试

### `cargo test` 的二进制加载即崩（0xC0000139）

现象很唬人：Rust 编译完全通过，`tauri build` 也能出包，但 `cargo test --lib` 的测试
二进制**一启动就退出**，一个测试都没跑到：

```
process didn't exit successfully: `...\sonde_lib-xxx.exe`
  (exit code: 0xC0000139, STATUS_ENTRYPOINT_NOT_FOUND)
```

没有任何 stderr，事件日志里也没有记录。

**根因**：`tauri-plugin-dialog`（经 `rfd`）静态导入 comctl32 的 `TaskDialogIndirect`，
而这个符号**只存在于 ComCtl32 版本 6**。Windows 默认给进程加载 System32 里的 v5，
只有可执行文件的清单声明了 `Microsoft.Windows.Common-Controls 6.0.0.0` 才会换成 v6。

应用二进制的清单由 `tauri_build::build()` 嵌好了，所以**应用没事**；测试二进制没有清单，
于是**只有测试挂**——这正是它难定位的地方。

仓库里 `src-tauri/build.rs` 已经修了（用 `/MANIFESTDEPENDENCY` 追加依赖声明）。
这里记下来是因为**换任何一个引入 comctl32 v6 API 的依赖都会再遇到**。

两条走不通的路，省得重试：

- `cargo:rustc-link-arg-tests` 要求包里有**独立的 test target**。本项目的测试是 lib 内的
  `#[cfg(test)]` 单元测试，cargo 会直接报 `does not have a test target`。
- 嵌一份完整的清单文件（`/MANIFEST:EMBED /MANIFESTINPUT:...`）会和 `tauri_build`
  自己嵌的那份打架。

### 怎么查「缺哪个符号」

`0xC0000139` 不告诉你缺什么。`dumpbin /dependents` 也只列 DLL，不列缺失的符号。
把导入表里每个符号逐个解析一遍才能逼出来：

```powershell
$db = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\<版本>\bin\Hostx64\x64\dumpbin.exe'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class N {
 [DllImport("kernel32", CharSet=CharSet.Ansi)] public static extern IntPtr LoadLibraryA(string n);
 [DllImport("kernel32", CharSet=CharSet.Ansi)] public static extern IntPtr GetProcAddress(IntPtr h, string n);
}
'@
$cur = $null; $checked = 0
foreach ($line in (& $db /imports $exe)) {
  $t = $line.ToString()
  if ($t -match '^\s{4}(\S+\.dll)\s*$') { $cur = $Matches[1]; continue }
  if ($cur -and $t -match '^\s+([0-9A-Fa-f]+)\s+(\S+)\s*$') {
    $fn = $Matches[2]
    if ($fn -match '^(Import|Index|stamp|Table|reference)$') { continue }
    $checked++
    $mod = [N]::LoadLibraryA($cur)
    if ([N]::GetProcAddress($mod, $fn) -eq [IntPtr]::Zero) { Write-Output "$cur !! $fn" }
  }
}
Write-Output "checked: $checked"   # 这行很重要,见下
```

**一定要打印 `checked` 的数量。** 第一版脚本的正则没匹配上 dumpbin 的行格式
（以为是「8 位十六进制 + 十进制 + 名字」，实际是「变长十六进制序号 + 名字」），
结果报告「0 个缺失」——**那是假通过**，差点把排查引向完全错误的方向。
任何检查在信它的「通过」之前，先确认它能报错。

---

## 远程操作（SSH）

如果你像 CI 或远程调试那样通过 SSH 驱动一台 Windows：

### 不要把复杂命令直接塞进 ssh 参数

命令要穿过 `ssh` → `cmd.exe` → `powershell -Command` 三层，引号和特殊字符会被逐层啃掉。
踩过的具体案例：

- `;` 在 cmd 里不是分隔符，整条命令被原样 echo 出来
- 正则里的 `|` 被 cmd 当成管道，命令从中间断开
- PowerShell 里带引号的参数（如 `--log "C:\path"`）会破坏下游的参数解析

**规矩：写成 `.ps1` 文件传过去执行。** 这能一次性消掉全部转义问题。

### PowerShell 5.1 的编码陷阱（三种，根因相同）

Windows 自带的是 PowerShell 5.1，它**读无 BOM 的 UTF-8 文件时按 ANSI 解释**。

1. **脚本里的中文注释会吞掉下一行。** 中文字节按 GBK 重新组合后可能吃掉换行符，
   于是紧跟在注释后面的 `$work = 'C:\...'` 变成了注释的一部分，后面所有用到 `$work`
   的地方全是 `$null`，报一屏「无法将参数绑定到参数"Path"，因为该参数是空值」。
   **脚本一律写成纯 ASCII + CRLF。**

2. **`Set-Content` 默认写 ANSI。** 用它改 `Cargo.toml` 会让 cargo 报
   `was not valid utf-8`。用 `[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))`。

3. **控制台输出是 GBK**，错误信息在 SSH 里显示成乱码。脚本开头加
   `[Console]::OutputEncoding = [Text.Encoding]::UTF8`。

### VS 安装器不能在 SSH 会话里跑

`vs_BuildTools.exe` 在 sshd 派生的会话里会在**解压阶段**失败：

```
Unable to create or save new files in the folder into which the files are being extracted.
```

而 `%TEMP%` 实际是可写的（拷个文件进去验证过）——它要的是正常的登录会话。

试过且**都不行**的绕法：直接运行、`Register-ScheduledTask`（`0x80004005`）、
`schtasks /Create`（`ERROR_INVALID_DATA`）、指定自定义 `TEMP`。
最后一种「静默返回 0 但什么都没装」尤其坑。

**在那台机器上手动双击安装一次**。之后安装器本体就位了，
后续的工作负载可以用命令行加（虽然它同样可能静默不干活——装完务必按上面的办法
确认 `cl.exe` 真的存在）。

---

## 跑测试和构建

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
npx tauri build
```

`cargo test` 不要带 `--target`：runner/本机的架构就是目标架构，带上它 cargo 会进
交叉编译模式，构建脚本和 proc-macro 的产物落在 host 的 `target/debug`，测试 exe 却在
`target/<triple>/debug`。

单元测试数会比 macOS 少一个——有一个测试是 `#[cfg(unix)]` 门控的符号链接测试。

## 已知不可用

本地 AI（llama.cpp）和 Python 工作台的运行时打包脚本
（`scripts/bundle-llama.sh`、`bundle-python.sh`）是 macOS 的。Windows 上这两个功能
会提示缺运行时。AI 面板改用云端模型不受影响。
