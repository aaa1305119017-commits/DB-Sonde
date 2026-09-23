/** One shared transport budget, independent from any consumer's cache. */
export function createQueryGate(limit = 3) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid query concurrency");
  let active = 0;
  const waiting: { start(): void; }[] = [];
  const acquire = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    if (active < limit) { active++; resolve(); return; }
    const entry = { start: () => { signal?.removeEventListener("abort", abort); resolve(); } };
    const abort = () => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal?.reason ?? new Error("Query cancelled"));
    };
    waiting.push(entry);
    signal?.addEventListener("abort", abort, { once: true });
  });
  const release = () => {
    const next = waiting.shift();
    if (next) next.start(); // transfer ownership, never expose a vacant slot before the waiter resumes
    else active--;
  };
  return async <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    await acquire(signal);
    try { signal?.throwIfAborted(); return await operation(); }
    finally { release(); }
  };
}
