export function matchDimensionValue(values: string[], text: string): string[] {
  const q = text.trim();
  if (!q) return [];
  const exact = values.filter((v) => v === q);
  if (exact.length) return exact;
  const lower = q.toLocaleLowerCase();
  const prefix = values.filter((v) => v.toLocaleLowerCase().startsWith(lower));
  if (prefix.length) return prefix;
  return values.filter((v) => v.toLocaleLowerCase().includes(lower));
}
