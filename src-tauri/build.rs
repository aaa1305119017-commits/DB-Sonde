fn main() {
    tauri_build::build();

    // Windows 上 `cargo test` 生成的测试二进制没有应用清单,于是加载 ComCtl32 v5;
    // 而 tauri-plugin-dialog(经 rfd)静态导入的 TaskDialogIndirect 只在 v6 里存在。
    // 结果测试进程在**加载期**就挂:0xC0000139 (STATUS_ENTRYPOINT_NOT_FOUND),
    // 一个测试都没跑到,也不说是哪个符号。应用二进制的清单由 tauri_build 嵌好了,
    // 所以应用构建和运行都正常 —— 只有测试挂,这正是它难定位的原因。
    //
    // 用 /MANIFESTDEPENDENCY 而不是嵌一份清单文件:它是往链接器生成的清单里**追加**
    // 一条依赖,和 tauri_build 自己那份不冲突。也不用 rustc-link-arg-tests ——
    // 那个要求包里有独立的 test target,而这里的测试是 lib 内的 #[cfg(test)]。
    //
    // 判目标系统要用 CARGO_CFG_TARGET_OS,不能用 #[cfg(windows)] —— 后者说的是
    // 跑构建脚本的这台机器,交叉编译时会判错。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' \
             name='Microsoft.Windows.Common-Controls' version='6.0.0.0' \
             processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
}
