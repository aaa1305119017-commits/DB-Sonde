import type { FileProfile } from "./fileCatalog";
import { enrichTasks } from "./fileCatalog";
import type { EtlSource } from "./types";

const address = (value?: string) => value?.replace(/\/+$/, "");
/** A missing association never matches every local directory. */
export function schedulerFileScope(baseUrl: string, sources: EtlSource[], profiles: FileProfile[]) {
  const target = address(baseUrl);
  const matched = target ? sources.filter(source => source.id.startsWith("files:") && address(source.schedulerBaseUrl) === target) : [];
  const ids = new Set(matched.map(source => source.id.slice("files:".length)));
  return {
    files: matched.flatMap(source => source.jobs),
    pathMappings: profiles.filter(profile => ids.has(profile.id) && address(profile.schedulerBaseUrl) === target)
      .flatMap(profile => profile.pathMappings ?? []),
  };
}

/** Build a single inventory publication without reading or changing application state. */
export function fileScanUpdates(fileSource: EtlSource, previous: EtlSource[], profiles: FileProfile[]): EtlSource[] {
  const sources = [...previous.filter(source => source.id !== fileSource.id), fileSource];
  const association = address(fileSource.schedulerBaseUrl);
  if (!association) return [fileSource];
  const scope = schedulerFileScope(association, sources, profiles);
  const matches = (job: EtlSource["jobs"][number]) => address(job.scheduler?.baseUrl) === association;
  const linked = sources.filter(source => !source.id.startsWith("files:") && source.jobs.some(matches)).map(source => ({
    ...source,
    jobs: source.jobs.map(job => matches(job) ? enrichTasks([job], scope.files, scope.pathMappings)[0] : job),
    updatedAt: fileSource.updatedAt,
  }));
  return [fileSource, ...linked];
}
