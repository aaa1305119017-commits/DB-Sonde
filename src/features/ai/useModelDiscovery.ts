import { useLayoutEffect, useState } from "react";
import { listModels } from "./aiClient";
import { createModelDiscovery, sameModelEndpoint, type ModelEndpoint } from "./modelDiscovery";

/** UI composition shared by settings and analysis. Credentials stay in memory only. */
export function useModelDiscovery(target: ModelEndpoint | null) {
  const [store] = useState(() => createModelDiscovery(listModels));
  const state = store();
  const provider = target?.provider, baseUrl = target?.baseUrl, apiKey = target?.apiKey;
  useLayoutEffect(() => {
    store.getState().setTarget(provider && baseUrl !== undefined ? { provider, baseUrl, apiKey } : null);
    return () => store.getState().dispose();
  }, [store, provider, baseUrl, apiKey]);
  const current = sameModelEndpoint(state.target, target);
  return {
    models: current ? state.models : [], loading: current && state.loading,
    loaded: current && state.loaded, error: current ? state.error : null,
    load: () => store.getState().load(),
  };
}
