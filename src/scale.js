// Sizing helpers shared by the map and the data scripts' consumers.

export const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const MIN_HEIGHT = 3;
export const MAX_HEIGHT = 40;

// Log scale: counts span several orders of magnitude, so linear would flatten everyone but one.
export function computeHeights(items, metric) {
  const vals = items.map((a) => Math.log10(Math.max(1, a[metric])));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return vals.map((v) => MIN_HEIGHT + ((v - min) / (max - min || 1)) * (MAX_HEIGHT - MIN_HEIGHT));
}
