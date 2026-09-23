import type { LayoutItem, LayoutPlan } from "./layout";
import type { ValidatedMetric } from "./state";

const scales = [{ prefix: "万", scale: "wan" }, { prefix: "亿", scale: "yi" }] as const;

/** Recognize only decimal display scaling of the exact catalog unit, never a currency conversion. */
export function normalizeDesignUnits(layout: LayoutPlan, definitions: ValidatedMetric[]): LayoutPlan {
  const known = new Map(definitions.map(metric => [metric.metricId, metric]));
  const normalize = (original: LayoutItem): LayoutItem => {
    const item = structuredClone(original);
    const ids = [...item.metricIds, ...(item.secondaryMetricIds ?? [])];
    if (item.scale !== undefined && item.numberFormat?.scale === undefined) {
      item.numberFormat = { ...item.numberFormat, scale: item.scale };
    }
    const requests = Object.entries(item.metrics ?? {}).flatMap(([id, value]) => {
      const unit = known.get(id)?.unit;
      if (!ids.includes(id) || !unit || !value.unit || value.unit.trim() === unit) return [];
      const found = scales.find(candidate => value.unit.trim() === candidate.prefix + unit);
      return found ? [{ id, unit, scale: found.scale }] : [];
    });
    const suffix = item.numberFormat?.suffix?.trim();
    const suffixScale = suffix && ids.length ? scales.find(candidate => ids.every(id => {
      const unit = known.get(id)?.unit;
      return unit && suffix !== unit && suffix === candidate.prefix + unit;
    }))?.scale : undefined;
    const requested = new Set([...requests.map(request => request.scale), ...(suffixScale ? [suffixScale] : [])]);
    const explicitScale = item.numberFormat?.scale ?? item.scale;
    const chosen = requested.size === 1 ? [...requested][0] : undefined;
    if (chosen && (explicitScale === undefined || explicitScale === chosen)) {
      item.numberFormat = { ...item.numberFormat, scale: chosen };
      for (const request of requests) item.metrics![request.id] = { ...item.metrics![request.id], unit: request.unit };
    }
    for (const [id, value] of Object.entries(item.metrics ?? {})) {
      const definition = known.get(id);
      if (definition && ids.includes(id) && value.unit !== undefined) {
        item.metrics![id] = { ...value, unit: value.unit.trim() || definition.unit };
      }
    }
    // A scaled value must not retain an unscaled unit label (1 万元 must not become 1 元).
    const activeScale = scales.find(candidate => candidate.scale === item.numberFormat?.scale);
    if (activeScale && suffix && ids.length && ids.every(id => known.get(id)?.unit === suffix)) {
      item.numberFormat = { ...item.numberFormat, suffix: activeScale.prefix + suffix };
    }
    // The designer contract says an empty suffix inherits the catalog unit.
    if (item.numberFormat?.suffix !== undefined && !item.numberFormat.suffix.trim()) delete item.numberFormat.suffix;
    item.tabs = item.tabs?.map(tab => ({ ...tab, items: tab.items.map(normalize) }));
    return item;
  };
  return { ...layout, items: layout.items.map(normalize) };
}
