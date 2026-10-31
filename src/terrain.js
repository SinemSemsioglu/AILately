// The terrain grid the map is drawn on, and finding which mountain a point on it belongs to.

export const SIZE = 360;
export const SEG = 300;
export const STEP = SIZE / SEG;
export const HALF = SIZE / 2;

// The peak under a terrain hit point, or -1. `sigma(h)` is a peak's width for its height.
export function peakAt(point, positions, heights, sigma) {
  let best = -1;
  let bestD = Infinity;
  positions.forEach((p, i) => {
    const d = Math.hypot(point.x - p.x, point.z - p.z);
    if (d < sigma(heights[i]) * 1.4 && d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
