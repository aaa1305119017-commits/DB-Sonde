import { nanoid } from "nanoid";
import { useState } from "react";
import { api } from "../../lib/api";
import { useScheduler } from "../scheduler/schedulerStore";
import { useEtl } from "./etlStore";
import { parseFileInventory, type FileProfile } from "./fileCatalog";
import { fileProfiles, saveFileProfile } from "./fileProfiles";
import { fileScanUpdates } from "./fileScope";
import type { EtlSource } from "./types";
export default function FileSourceForm({ onDone }: { onDone: () => void; }) {
  const schedulers = useScheduler((s) => s.conns);
  const [profile, setProfile] = useState<FileProfile>(
    () =>
      fileProfiles()[0] ?? {
        id: nanoid(8),
        name: "ETL 文件目录",
        root: "",
        schedulerBaseUrl: schedulers.length === 1 ? schedulers[0].baseUrl : undefined,
      },
  );
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(profile.pathMappings?.[0]?.from ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const scan = async () => {
    setBusy(true);
    setMessage("");
    try {
      const current = { ...profile, pathMappings: from ? [{ from, to: profile.root }] : [] };
      const inventory = await api.inspectEtlFiles({ ...current, password });
      const parsed = await parseFileInventory(inventory, current, api.pySqlLineage);
      // Save the association first; publish the inventory and linked tasks together.
      saveFileProfile(current);
      const fileSource: EtlSource = {
        id: `files:${current.id}`,
        name: current.name,
        kind: "generic",
        jobs: parsed.jobs,
        schedulerBaseUrl: current.schedulerBaseUrl,
        updatedAt: Date.now(),
      };
      useEtl.getState().upsertSources(fileScanUpdates(fileSource, useEtl.getState().sources, fileProfiles()));
      setMessage(
        `扫描完成：${parsed.jobs.length} 个文件；${parsed.warnings.length} 条待处理信息${parsed.warnings.length ? "\n" + parsed.warnings.join("\n") : ""}`,
      );
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
      setPassword("");
    }
  };
  return (
    <div className="etl-add">
      <h3>自动识别 ETL 目录</h3>
      <p>读取 DataX、SQL 与脚本引用；不会运行 ETL。SSH 复用系统已信任主机，密码仅用于本次读取。</p>
      <label className="etl-field">
        已有目录
        <select
          className="input"
          value={profile.id}
          onChange={(e) => {
            const p = fileProfiles().find((p) => p.id === e.target.value);
            if (p) {
              setProfile(p);
              setFrom(p.pathMappings?.[0]?.from ?? "");
            } else {
              setProfile({ id: nanoid(8), name: "", root: "" });
              setFrom("");
            }
          }}
        >
          <option value="">新目录</option>
          {fileProfiles().map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ["name", "名称"],
          ["root", "目录绝对路径"],
          ["host", "SSH 主机（本地留空）"],
          ["username", "SSH 用户名"],
        ] as const
      ).map(([key, label]) => (
        <label className="etl-field" key={key}>
          {label}
          <input
            className="input"
            value={profile[key] ?? ""}
            onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
          />
        </label>
      ))}
      {profile.host && (
        <label className="etl-field">
          SSH 密码（使用密钥时留空）
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      )}
      <label className="etl-field">
        关联调度连接
        <select
          className="input"
          value={profile.schedulerBaseUrl ?? ""}
          onChange={(e) => setProfile({ ...profile, schedulerBaseUrl: e.target.value || undefined })}
        >
          <option value="">仅分析目录</option>
          {schedulers.map((c) => (
            <option key={c.id} value={c.baseUrl}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="etl-field">
        调度中的目录前缀（路径不同才填写）
        <input className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <div className="etl-add-actions">
        <button className="btn" onClick={onDone}>
          返回
        </button>
        <button className="btn primary" disabled={busy || !profile.root} onClick={() => void scan()}>
          {busy ? "读取并解析中…" : "扫描 / 刷新"}
        </button>
      </div>
      {message && (
        <pre className="etl-error" style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
          {message}
        </pre>
      )}
    </div>
  );
}
