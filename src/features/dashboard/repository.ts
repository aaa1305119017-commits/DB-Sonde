import { api } from "../../lib/api";
import type { DashboardDocument } from "./domain";
import { normalizeDashboard } from "./domain";

/** Storage boundary for local documents. Remote BI synchronization is a
 * separate connector concern and never changes this contract. */
export interface DashboardRepository {
  list(): Promise<DashboardDocument[]>;
  save(document: DashboardDocument): Promise<DashboardDocument>;
  publish(document: DashboardDocument): Promise<DashboardDocument>;
  listVersions(id: string): Promise<DashboardDocument[]>;
  delete(id: string): Promise<void>;
}

export const dashboardRepository: DashboardRepository = {
  async list() {
    return (await api.listDashboards()).map(normalizeDashboard);
  },
  async save(document) {
    return normalizeDashboard(await api.saveDashboard(document));
  },
  async publish(document) {
    return normalizeDashboard(await api.publishDashboard(document));
  },
  async listVersions(id) {
    return (await api.listDashboardVersions(id)).map(normalizeDashboard);
  },
  delete(id) {
    return api.deleteDashboard(id);
  },
};
