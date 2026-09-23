import { storedRepository, type JsonStoragePort, type StoredRepository } from "../../lib/storedRepository";
import { assertStorageReadable, readStoredText } from "../../lib/jsonStorage";
import { blankAnalysisDraft, isSavedAnalysisDraft, normalizeAnalysisDraft, type SavedAnalysisDraft } from "./analysisDraft";
import { economicalSavedChoice } from "./model/analysisModels";
import type { AnalysisDraft } from "./analysisTypes";

const KEY = "sonde.analysis.v1";
const MIGRATION_KEY = "sonde.analysis.flash-default.v1";
function legacyMigrationComplete(): boolean {
  const value = readStoredText<string>(MIGRATION_KEY, "0", value => value === "1");
  assertStorageReadable(MIGRATION_KEY);
  return value === "1";
}

export interface AnalysisDraftRepository extends StoredRepository<AnalysisDraft> { reset(): void; }

export function createAnalysisRepository(options: {
  now?: () => Date;
  storage?: JsonStoragePort;
  legacyMigrationComplete?: () => boolean;
} = {}): AnalysisDraftRepository {
  const now = options.now ?? (() => new Date());
  const records = storedRepository<SavedAnalysisDraft>(KEY, () => ({}), isSavedAnalysisDraft, options.storage);
  let migrationReadable = true;
  return {
    load() {
      const saved = records.load();
      const draft = normalizeAnalysisDraft(saved, blankAnalysisDraft(now()));
      migrationReadable = true;
      try {
        if (saved.modelChoiceMigration !== 1 && !(options.legacyMigrationComplete ?? legacyMigrationComplete)()) {
          draft.modelChoice = economicalSavedChoice(draft.modelChoice);
        }
      } catch {
        // Retain readable selections if a separate legacy marker is inaccessible.
        migrationReadable = false;
      }
      return draft;
    },
    reset() {
      if (!migrationReadable) throw new Error("分析草稿的旧迁移记录不可读，已暂停覆盖。");
      // No form values remain: calendar defaults are recomputed on the next launch.
      records.save({ modelChoiceMigration: 1 });
    },
    save(draft) {
      if (!migrationReadable) throw new Error("分析草稿的旧迁移记录不可读，已暂停覆盖。");
      if (!isSavedAnalysisDraft(draft)) throw new Error("分析草稿格式无效，未保存。");
      // Store the marker with the draft, avoiding a two-key partial migration.
      records.save({ ...draft, modelChoiceMigration: 1 });
    },
  };
}
