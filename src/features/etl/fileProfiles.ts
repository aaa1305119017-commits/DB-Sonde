import { assertStorageReadable } from "../../lib/jsonStorage";
import { hasOptionalText, isIdentifiedList, isNonEmptyText, isRecord, isText, storedRepository } from "../../lib/storedRepository";
import type { FileProfile } from "./fileCatalog";

export function isFileProfile(value: unknown): value is FileProfile {
  return isRecord(value) && isNonEmptyText(value.id) && isText(value.name) && isNonEmptyText(value.root)
    && hasOptionalText(value, ["schedulerBaseUrl", "host", "username"])
    && (value.port === undefined || (typeof value.port === "number" && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535))
    && (value.pathMappings === undefined || (Array.isArray(value.pathMappings) && value.pathMappings.every(mapping =>
      isRecord(mapping) && isNonEmptyText(mapping.from) && isNonEmptyText(mapping.to))));
}
const KEY = "sonde.etl-file-profiles.v1";
export const fileProfileRepository = storedRepository<FileProfile[]>(
  KEY, () => [], value => isIdentifiedList(value, isFileProfile),
);
export const fileProfiles = () => fileProfileRepository.load();
/** Dependent synchronization must not treat unreadable mappings as an empty configuration. */
export function requireFileProfiles(): FileProfile[] {
  const profiles = fileProfiles();
  assertStorageReadable(KEY);
  return profiles;
}
export function saveFileProfile(profile: FileProfile): void {
  fileProfileRepository.save([...fileProfiles().filter(p => p.id !== profile.id), profile]);
}
