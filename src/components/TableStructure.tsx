import { KeyRound, LockKeyhole } from "lucide-react";
import type { TableContext } from "../types";
import { useI18n } from "../hooks/useI18n";

export default function TableStructure({ context }: { context: TableContext }) {
  const { t } = useI18n();
  return (
    <div className="structure-view">
      <div className="structure-summary">
        <strong>{context.table}</strong>
        <span>{t("structure.columns", { count: context.columns.length })}</span>
        <span className={context.editable ? "editable-ok" : "editable-off"}>
          <LockKeyhole size={12} />
          {context.editable ? t("structure.editEnabled") : context.editDisabledReason}
        </span>
      </div>
      <div className="structure-table">
        <div className="structure-row structure-head">
          <span>{t("column.name")}</span>
          <span>{t("column.type")}</span>
          <span>{t("structure.nullable")}</span>
          <span>{t("inspector.default")}</span>
        </div>
        {context.columns.map((column) => (
          <div className="structure-row" key={column.name}>
            <span className="structure-name">
              {column.isPrimaryKey && <KeyRound size={12} />}
              {column.name}
            </span>
            <span className="mono">{column.dataType}</span>
            <span>{column.nullable ? t("structure.yes") : t("structure.no")}</span>
            <span className="mono muted">{column.defaultValue ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
