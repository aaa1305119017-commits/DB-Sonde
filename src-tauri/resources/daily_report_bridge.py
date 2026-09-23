"""Bundled SSH bridge. Read reports or request a new run of the installed checker."""
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import date, datetime
from pathlib import Path


def observed_status(report):
    if report.get("status") == "running" and report.get("pid"):
        try:
            os.kill(report["pid"], 0)
        except ProcessLookupError:
            report["status"] = "error"
            report.setdefault("coverage", []).append({"status": "error", "message": "检查进程已退出，结果尚未完成，请重新检查"})
    return report


def main(request):
    root = Path(request["root"]).expanduser().resolve()
    config_path = root / "config.json"
    if not config_path.is_file():
        return {"error": "服务端尚未安装每日检查，或服务目录不正确"}
    config = json.loads(config_path.read_text())
    output = Path(config["reportDir"]).resolve()
    action = request.get("action", "list")
    if action == "list":
        index = output / "index.json"
        history = [observed_status(r) for r in json.loads(index.read_text())] if index.is_file() else []
        latest = history[0] if history else {}
        return {"reports": history,
                "chains": latest.get("availableChains") or sorted({r.get("chain", "未归属链路") for r in config.get("rules", [])}),
                "tables": latest.get("availableTables") or sorted({t for r in config.get("rules", []) for t in [r.get("targetTable", ""), *r.get("sourceTables", [])] if t}),
                "schedule": config.get("scheduleLabel", "尚未配置每日自动检查"),
                "lookbackDays": config.get("lookbackDays", 7)}
    if action == "run":
        import fcntl
        start, end = date.fromisoformat(request["start"]), date.fromisoformat(request["end"])
        if start > end or (end-start).days > 366:
            raise ValueError("日期范围无效；单次最多检查 367 天")
        output.mkdir(parents=True, exist_ok=True)
        # Serialize start requests, including the small interval before the child
        # has acquired its own execution lock.
        with (output / ".request.lock").open("w") as request_lock:
            fcntl.flock(request_lock, fcntl.LOCK_EX)
            with (output / ".run.lock").open("w") as run_lock:
                try:
                    fcntl.flock(run_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return {"error": "已有检查正在执行，请等待完成后重试"}
                pending = output / ".pending.json"
                if pending.exists():
                    previous = json.loads(pending.read_text())
                    try:
                        os.kill(previous["pid"], 0)
                        return {"error": "已有手动检查正在启动，请稍后刷新"}
                    except ProcessLookupError:
                        pass
                run_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8]
                executable = config["python"]
                runner = root / "runner.py"
                if not runner.is_file() or not Path(executable).is_file():
                    return {"error": "服务端检查程序或 Python 环境缺失"}
                args = [executable, str(runner), "--config", str(config_path), "--start", str(start), "--end", str(end), "--run-id", run_id]
                for key in ("chain", "table"):
                    if request.get(key):
                        args.extend(["--" + key, str(request[key])])
                # Child acquires run lock after this context closes. Child retries
                # briefly to avoid failing while its parent still holds the lock.
                with (output / (run_id + ".log")).open("w") as log:
                    process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, close_fds=True)
                pending.write_text(json.dumps({"id": run_id, "pid": process.pid}))
                os.chmod(pending, 0o600)
                return {"id": run_id, "status": "queued"}
    if action == "read":
        run_id = request["id"]
        if not re.fullmatch(r"[A-Za-z0-9-]+", run_id):
            raise ValueError("检查编号无效")
        path = output / (run_id + ".json")
        if not path.is_file():
            return {"error": "该检查尚未生成结果，请稍后刷新"}
        report = observed_status(json.loads(path.read_text()))
        query = str(request.get("query", "")).strip().lower()
        state = request.get("state", "all")
        checks = report.get("checks", [])
        rows = []
        for check in checks:
            common = {"checkId": check["id"], "chain": check["chain"], "sourceTables": check["sourceTables"], "targetTable": check["targetTable"], "status": check["status"], "rule": check["name"]}
            for issue in check.get("issues", []):
                row = {**common, **issue}
                if (state == "all" or state == row.get("kind")) and (not query or query in json.dumps(row, ensure_ascii=False).lower()):
                    rows.append(row)
            check["issueCount"] = len(check.pop("issues", []))
        offset = max(0, int(request.get("offset", 0)))
        report["issueRows"] = rows[offset:offset+100]
        report["filteredIssueCount"] = len(rows)
        report["offset"] = offset
        return {"report": report}
    raise ValueError("不支持的每日汇报操作")


if __name__ == "__main__":
    try:
        print(json.dumps(main(json.loads(sys.argv[1])), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else "服务端请求失败（" + type(exc).__name__ + "）"}, ensure_ascii=False))
