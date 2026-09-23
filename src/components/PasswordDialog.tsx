import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, X } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { useApp } from "../store/appStore";

export default function PasswordDialog({ connectionId }: { connectionId: string }) {
  const { t } = useI18n();
  const connection = useApp((state) =>
    state.connections.find((item) => item.id === connectionId),
  );
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  if (!connection) return null;

  const close = () => useApp.getState().closePasswordPrompt();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await useApp.getState().connect(connectionId, password);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <form className="modal" style={{ width: 440 }} onSubmit={submit}>
        <div className="modal-head">
          <h3>{t("passwordPrompt.title")}</h3>
          <button className="icon-btn" type="button" style={{ marginLeft: "auto" }} onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="conn-pill" style={{ display: "flex", width: "fit-content" }}>
              <KeyRound size={14} />
              {t("passwordPrompt.connection", {
                name: connection.name,
                username: connection.username || "—",
                host: connection.host || connection.database,
              })}
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="session-database-password">{t("connection.password")}</label>
            <input
              id="session-database-password"
              className="input"
              type="password"
              value={password}
              autoFocus
              autoComplete="off"
              onChange={(event) => setPassword(event.target.value)}
            />
            <div className="muted" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
              {t("passwordPrompt.help")}
            </div>
          </div>
          {error && <div className="test-result err" title={error}>{error}</div>}
        </div>
        <div className="modal-foot">
          <span style={{ marginRight: "auto" }} />
          <button className="btn" type="button" onClick={close}>
            {t("action.cancel")}
          </button>
          <button className="btn primary" type="submit" disabled={submitting}>
            {submitting && <Loader2 size={15} className="spin" />}
            {t("passwordPrompt.connect")}
          </button>
        </div>
      </form>
    </div>
  );
}
