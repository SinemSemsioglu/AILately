import { fbm, mulberry32 } from './lib/noise.js';

// The atlas geography comes from the data rather than fixed territories.
//
//   1. Towns (accounts) and topics are laid out together by a force simulation: each account is pulled
//      toward its long-term interests and loosely toward the rest of its group; everything repels
//      everything else so nothing overlaps. Shared topics settle between the communities that discuss them.
//   2. Today's topic mountains rise between their long-term spot and the towns of today's participants.
//   3. Land is wherever towns and mountains are dense: the coastline is a contour of that density, so
//      outlying communities become peninsulas or islands.
//   4. Each group gets a centre for its name (its borders are drawn by the renderer from the towns).
//
// Towns would be recomputed every few weeks ("slow towns"), mountains every day ("fast mountains").

const ITERATIONS = 500;
const FIT_RADIUS = 120; // the laid-out nodes are scaled to fit this radius
const PEAK_SPACING = 20;
const HOME_RADIUS = 70; // groups' home areas sit around a circle this far from the middle
const GRID = 2; // land/border field resolution, world units
const EXTENT = 180; // fields cover -EXTENT…EXTENT on both axes
const N = Math.round((EXTENT * 2) / GRID) + 1;

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

function centroid(points) {
  if (!points.length) return null;
  let x = 0;
  let z = 0;
  for (const p of points) (x += p.x), (z += p.z);
  return { x: x / points.length, z: z / points.length };
}

function forceLayout(accounts, topics, interests, regions) {
  const rand = mulberry32(7);
  const nA = accounts.length;
  const groupIndex = Object.fromEntries(regions.map((r, i) => [r.id, i]));
  const angleOf = (g) => (groupIndex[g] / regions.length) * Math.PI * 2;

  // Start each group in its own direction so groups begin apart; topics between their groups.
  const nodes = [
    ...accounts.map((a) => {
      const ang = angleOf(a.region) + (rand() - 0.5) * 0.8;
      const r = 45 + rand() * 30;
      return { x: Math.cos(ang) * r, z: Math.sin(ang) * r, group: groupIndex[a.region], topic: false };
    }),
    ...topics.map((t) => {
      let x = 0;
      let z = 0;
      for (const [g, share] of t.groups) (x += Math.cos(angleOf(g)) * 40 * share), (z += Math.sin(angleOf(g)) * 40 * share);
      return { x: x + (rand() - 0.5) * 6, z: z + (rand() - 0.5) * 6, topic: true, group: groupIndex[t.region] };
    }),
  ];
  const links = interests.flatMap((list, a) => list.map(([t, w]) => [a, nA + t, w]));
  const homes = regions.map((_, g) => ({ x: Math.cos(angleOf(regions[g].id)) * HOME_RADIUS, z: Math.sin(angleOf(regions[g].id)) * HOME_RADIUS }));

  for (let it = 0; it < ITERATIONS; it++) {
    const heat = 1 - it / ITERATIONS;
    const fx = new Float32Array(nodes.length);
    const fz = new Float32Array(nodes.length);

    // Repulsion: topics need the most room (they become mountains).
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz + 0.5;
        if (d2 > 2500) continue;
        const k = a.topic && b.topic ? 1100 : a.topic || b.topic ? 160 : 90;
        const f = k / d2;
        const d = Math.sqrt(d2);
        fx[i] -= (dx / d) * f;
        fz[i] -= (dz / d) * f;
        fx[j] += (dx / d) * f;
        fz[j] += (dz / d) * f;
      }
    }
    // Interests: springs between an account and each of its long-term topics.
    for (const [a, t, w] of links) {
      const dx = nodes[t].x - nodes[a].x;
      const dz = nodes[t].z - nodes[a].z;
      const d = Math.hypot(dx, dz) || 0.01;
      const f = 0.06 * w * (d - 10);
      fx[a] += (dx / d) * f;
      fz[a] += (dz / d) * f;
      fx[t] -= (dx / d) * f * 0.3;
      fz[t] -= (dz / d) * f * 0.3;
    }
    // Groups: a gentle pull toward the group's centre keeps communities recognisable, and a pull toward
    // the group's home area (spread around the map) keeps groups from all converging on shared topics.
    // Topics feel their main group's home too, more weakly.
    const centres = regions.map((_, g) => centroid(nodes.filter((n) => !n.topic && n.group === g)));
    nodes.forEach((n, i) => {
      if (!n.topic && centres[n.group]) {
        fx[i] += (centres[n.group].x - n.x) * 0.07;
        fz[i] += (centres[n.group].z - n.z) * 0.07;
      }
      const home = homes[n.group];
      if (home) {
        const k = n.topic ? 0.015 : 0.03;
        fx[i] += (home.x - n.x) * k;
        fz[i] += (home.z - n.z) * k;
      }
      fx[i] -= n.x * 0.004; // keep the whole map together
      fz[i] -= n.z * 0.004;
    });

    const maxStep = 0.3 + 3 * heat;
    nodes.forEach((n, i) => {
      const len = Math.hypot(fx[i], fz[i]);
      const s = len > maxStep ? maxStep / len : 1;
      n.x += fx[i] * s;
      n.z += fz[i] * s;
    });
  }

  // Fit to the map.
  const c = centroid(nodes);
  const r = Math.max(...nodes.map((n) => Math.hypot(n.x - c.x, n.z - c.z))) || 1;
  for (const n of nodes) {
    n.x = ((n.x - c.x) / r) * FIT_RADIUS;
    n.z = ((n.z - c.z) / r) * FIT_RADIUS;
  }
  return { towns: nodes.slice(0, nA), topicSpots: nodes.slice(nA) };
}

// A field sampled on the grid, read back with bilinear interpolation.
function sampler(values) {
  return (x, z) => {
    const fx = Math.min(N - 1.001, Math.max(0, (x + EXTENT) / GRID));
    const fz = Math.min(N - 1.001, Math.max(0, (z + EXTENT) / GRID));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const v = (i, k) => values[k * N + i];
    return (v(ix, iz) * (1 - tx) + v(ix + 1, iz) * tx) * (1 - tz) + (v(ix, iz + 1) * (1 - tx) + v(ix + 1, iz + 1) * tx) * tz;
  };
}

// Only active accounts (those with interests, i.e. that posted in the data window) and topics shape
// the layout and the land. Quiet accounts are placed afterwards as extra towns near their group's active
// ones, marked `quiet`, without moving anything else; a renderer can show or hide them.
export function atlasLayout({ accounts, topics, interests, participants, regions, topicSigma, topicHeights, coast }) {
  const activeIdx = accounts.map((_, i) => i).filter((i) => interests[i].length > 0);
  const laid = forceLayout(
    activeIdx.map((i) => accounts[i]),
    topics,
    activeIdx.map((i) => interests[i]),
    regions
  );
  const topicSpots = laid.topicSpots;
  const towns = new Array(accounts.length).fill(null);
  activeIdx.forEach((i, k) => (towns[i] = laid.towns[k]));

  // Today's mountains: mostly in the home of the group that discusses the topic most, leaning toward
  // today's participants. Pulling toward one group (rather than the average of everyone) keeps topics
  // shared by many groups from all piling up in the middle.
  const groupIndex = Object.fromEntries(regions.map((r, i) => [r.id, i]));
  const activeTowns = towns.filter(Boolean);
  const groupHome = regions.map((_, g) => centroid(activeTowns.filter((t) => t.group === g)));
  const peaks = topics.map((topic, t) => {
    const crowd = centroid(participants[t].map((a) => towns[a]).filter(Boolean)) ?? topicSpots[t];
    const home = groupHome[groupIndex[topic.region]] ?? crowd;
    return lerp(lerp(home, crowd, 0.45), topicSpots[t], 0.15);
  });
  // Keep mountains apart in proportion to their size, so each one reads on its own.
  const spacing = (i, j) => Math.max(PEAK_SPACING, (topicSigma(topicHeights[i]) + topicSigma(topicHeights[j])) * 1.4);
  for (let it = 0; it < 120; it++) {
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < peaks.length; j++) {
        const dx = peaks[j].x - peaks[i].x;
        const dz = peaks[j].z - peaks[i].z;
        const d = Math.hypot(dx, dz) || 0.01;
        const gap = spacing(i, j);
        if (d >= gap) continue;
        const push = (gap - d) / 2;
        peaks[i].x -= (dx / d) * push;
        peaks[i].z -= (dz / d) * push;
        peaks[j].x += (dx / d) * push;
        peaks[j].z += (dz / d) * push;
      }
    }
  }
  // Keep the summits clear: towns in a mountain's core move out to its foothills.
  for (const town of activeTowns) {
    peaks.forEach((pk, t) => {
      const core = topicSigma(topicHeights[t]) * 0.9;
      const dx = town.x - pk.x;
      const dz = town.z - pk.z;
      const d = Math.hypot(dx, dz) || 0.01;
      if (d < core) Object.assign(town, { x: pk.x + (dx / d) * core, z: pk.z + (dz / d) * core });
    });
  }

  // Land: density of towns and mountains, with a ragged noise edge.
  const density = new Float32Array(N * N);
  for (let k = 0; k < N; k++) {
    const z = k * GRID - EXTENT;
    for (let i = 0; i < N; i++) {
      const x = i * GRID - EXTENT;
      let d = 0;
      for (const p of activeTowns) d += Math.exp(-((p.x - x) ** 2 + (p.z - z) ** 2) / (2 * 13 * 13));
      peaks.forEach((p, t) => {
        const s = topicSigma(topicHeights[t]) * 1.7;
        d += 1.4 * Math.exp(-((p.x - x) ** 2 + (p.z - z) ** 2) / (2 * s * s));
      });
      density[k * N + i] = d + (fbm(x * 0.03 + 11, z * 0.03 + 11, 4) - 0.5) * 0.5;
    }
  }

  const landAt = sampler(density);
  const groupCentres = Object.fromEntries(
    regions.map((r, g) => [r.id, groupHome[g]]).filter(([, c]) => c)
  );

  // Quiet accounts: on a spiral around their group's active centre, on land, clear of other towns and of
  // the mountains' cores.
  const groupIndexOf = Object.fromEntries(regions.map((r, i) => [r.id, i]));
  const placed = [...activeTowns];
  const spiralStep = new Map();
  accounts.forEach((a, i) => {
    if (towns[i]) return;
    const g = groupIndexOf[a.region];
    const c = groupHome[g] ?? { x: 0, z: 0 };
    let spot = null;
    for (let s = spiralStep.get(g) ?? 0; s < 4000; s++) {
      const r = 4 + 3.2 * Math.sqrt(s);
      const x = c.x + Math.cos(s * 2.39996) * r;
      const z = c.z + Math.sin(s * 2.39996) * r;
      if (landAt(x, z) < coast + 0.1) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5)) continue;
      if (peaks.some((pk, t) => Math.hypot(pk.x - x, pk.z - z) < topicSigma(topicHeights[t]) * 0.9)) continue;
      spot = { x, z };
      spiralStep.set(g, s + 1);
      break;
    }
    towns[i] = { ...(spot ?? c), group: g, quiet: true };
    placed.push(towns[i]);
  });

  return {
    towns,
    peaks,
    density: landAt,
    groupCentres,
  };
}
