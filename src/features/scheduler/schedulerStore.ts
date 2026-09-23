import { nanoid } from "nanoid";
import { api } from "../../lib/api";
import { etlSourcesForSync, useEtl } from "../etl/etlStore";
import { requireFileProfiles } from "../etl/fileProfiles";
import { schedulerConnections } from "./connectionRepository";
import { synchronizeDefinitions } from "./definitionSync";
import { getProvider } from "./providers";
import { createSchedulerStore } from "./schedulerRuntime";

/** Application composition: all platform/global dependencies enter at this boundary. */
export const useScheduler = createSchedulerStore({
  connections: schedulerConnections,
  provider: getProvider,
  id: () => nanoid(8),
  syncDefinitions: request => synchronizeDefinitions(request, {
    sources: etlSourcesForSync, profiles: requireFileProfiles, parseSql: api.pySqlLineage,
    publish: source => useEtl.getState().upsertSource(source), now: Date.now,
  }),
  interval: (callback, ms) => { const timer = setInterval(callback, ms); return () => clearInterval(timer); },
  delay: (callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); },
});
