import { storedRepository, type JsonStoragePort, type StoredRepository } from "../../lib/storedRepository";
import { isSavedAiConfig, restoreAiConfig, savedAiConfig, type SavedAiConfig } from "./aiConfigModel";
import type { AiConfig } from "./aiTypes";
import { secureRepository } from "../../lib/secureRepository";

const encrypted = secureRepository<SavedAiConfig>("ai.config", () => ({}), isSavedAiConfig);

/** Injected storage is for isolated hosts/tests; desktop settings use the encrypted vault. */
export function createAiConfigRepository(storage?: JsonStoragePort): StoredRepository<AiConfig> {
  const records = storage ? storedRepository<SavedAiConfig>("ai.config", () => ({}), isSavedAiConfig, storage) : encrypted;
  return {
    load: () => restoreAiConfig(records.load()),
    save: config => records.save(savedAiConfig(config)),
  };
}
