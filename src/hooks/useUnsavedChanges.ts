import { useEffect } from "react";
import { useApp } from "../store/appStore";

export function useUnsavedChanges(tabId: string, dirty: boolean) {
  useEffect(() => { useApp.getState().setTabDirty(tabId, dirty); }, [tabId, dirty]);
  useEffect(() => () => { useApp.getState().setTabDirty(tabId, false); }, [tabId]);
}
