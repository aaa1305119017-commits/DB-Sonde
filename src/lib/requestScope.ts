/** Latest-response ownership, independent of UI, transport and AbortController support. */
export function createRequestScope() {
  let generation = 0;
  const latest = new Map<string, object>();
  const pending = new Set<object>();
  const capture = () => { const current = generation; return () => current === generation; };
  return {
    capture,
    invalidate(key?: string) {
      if (key === undefined) { generation++; latest.clear(); pending.clear(); }
      else { const owner = latest.get(key); if (owner) pending.delete(owner); latest.delete(key); }
    },
    isPending(key: string): boolean { const owner = latest.get(key); return !!owner && pending.has(owner); },
    begin(key: string) {
      const validScope = capture();
      const owner = {};
      const previous = latest.get(key);
      if (previous) pending.delete(previous);
      latest.set(key, owner);
      pending.add(owner);
      return {
        isCurrent: () => validScope() && latest.get(key) === owner,
        finish: () => { pending.delete(owner); },
      };
    },
  };
}
