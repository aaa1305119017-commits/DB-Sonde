import { assertStorageReadable, readStoredJson, writeStoredJson } from "../../lib/jsonStorage";
import { create } from "zustand";
import { nanoid } from "nanoid";
import type { EtlKind, EtlSource, EtlFieldMapping } from "./types";
import { getEtlAdapter } from "./adapters";

const KEY = "sonde.etlSources.v1";

function load(): EtlSource[] {
  return readStoredJson(KEY, [], value => Array.isArray(value) && value.every(item => item && typeof item.id === "string" && Array.isArray(item.jobs)));
}
function persist(list: EtlSource[]): void {
  writeStoredJson(KEY, list);
}

interface EtlState {
  open: boolean;
  sources: EtlSource[];
  selectedId: string | null;

  setOpen: (open: boolean) => void;
  select: (id: string | null) => void;
  /** Create a source by parsing config text with the chosen adapter. */
  addSource: (name: string, kind: EtlKind, text: string) => void;
  /** Create a source from already-parsed jobs (bulk folder import). */
  addSourceJobs: (name: string, kind: EtlKind, jobs: EtlSource["jobs"], fieldMapping?: EtlFieldMapping) => void;
  /** Parse more config into an existing source (appends jobs). */
  importMore: (id: string, text: string) => void;
  removeSource: (id: string) => void;
  /** 删掉一个作业 —— 服务器上那个作业已经下线/删除了,清单里还留着就会一直
   *  把不存在的表画进血缘。比整个源删掉重导轻得多(重导要连服务器)。 */
  removeJob: (sourceId: string, jobId: string) => void;
  upsertSource: (source: EtlSource) => void;
  upsertSources: (sources: EtlSource[]) => void;
}

export const useEtl = create<EtlState>((set, get) => ({
  open: false,
  sources: load(),
  selectedId: null,

  setOpen: (open) => set({ open }),
  select: (id) => set({ selectedId: id }),

  addSource: (name, kind, text) => {
    const jobs = getEtlAdapter(kind).parse(text); // throws on bad input
    const src: EtlSource = {
      id: nanoid(8),
      name: name.trim() || getEtlAdapter(kind).label,
      kind,
      jobs,
      updatedAt: Date.now(),
    };
    const list = [...get().sources, src];
    persist(list);
    set({ sources: list, selectedId: src.id });
  },

  addSourceJobs: (name, kind, jobs, fieldMapping) => {
    if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error("导入作业标识重复，请检查来源文件");
    const src: EtlSource = {
      id: nanoid(8),
      name: name.trim() || getEtlAdapter(kind).label,
      kind,
      jobs,
      fieldMapping,
      updatedAt: Date.now(),
    };
    const list = [...get().sources, src];
    persist(list);
    set({ sources: list, selectedId: src.id });
  },

  importMore: (id, text) => {
    const src = get().sources.find((s) => s.id === id);
    if (!src) return;
    const jobs = getEtlAdapter(src.kind).parse(text, src.fieldMapping); // throws on bad input
    if (jobs.some(job => src.jobs.some(existing => existing.id === job.id))) throw new Error("作业标识已存在，请勿重复追加同一作业");
    const list = get().sources.map((s) =>
      s.id === id ? { ...s, jobs: [...s.jobs, ...jobs], updatedAt: Date.now() } : s,
    );
    persist(list);
    set({ sources: list });
  },

  upsertSource: (source) => get().upsertSources([source]),
  upsertSources: (sources) => {
    const ids = new Set(sources.map(source => source.id));
    if (ids.size !== sources.length) throw new Error("来源标识重复，未保存");
    const list = [...get().sources.filter(source => !ids.has(source.id)), ...sources];
    persist(list);
    set({ sources: list });
  },
  removeJob: (sourceId, jobId) => {
    const list = get().sources.map((s) =>
      s.id === sourceId ? { ...s, jobs: s.jobs.filter((j) => j.id !== jobId), updatedAt: Date.now() } : s,
    );
    persist(list);
    set({ sources: list });
  },

  removeSource: (id) => {
    const list = get().sources.filter((s) => s.id !== id);
    persist(list);
    set((s) => ({ sources: list, selectedId: s.selectedId === id ? null : s.selectedId }));
  },
}));

/** Synchronizers cannot interpret a failed catalog read as proof that all jobs were removed. */
export function etlSourcesForSync(): EtlSource[] {
  assertStorageReadable(KEY);
  return useEtl.getState().sources;
}
