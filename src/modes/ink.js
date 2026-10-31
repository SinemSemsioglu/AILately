import * as THREE from 'three';
import { fbm, mulberry32 } from '../lib/noise.js';
import { smoothstep, MIN_HEIGHT, MAX_HEIGHT } from '../scale.js';
import { SIZE, SEG, STEP, HALF, peakAt } from '../terrain.js';
import { atlasLayout } from '../atlas-layout.js';
import { effectiveMood, lobeOutlooks } from '../mood.js';

// The atlas as a floating island drawn in black and white ink.
//
// On top: people and organisations are towns (sized by reach), today's topics are the mountains
// (height = buzz), rising among the towns of the people discussing them. The land comes from the data
// (see atlas-layout.js); groups are marked by dashed borders. Hovering a mountain draws ink trails
// from today's participants; hovering a town draws trails to the topics it joined today.
//
// Mood (unless switched off): each group's land gets a faint wash of the group's overall outlook, and
// each topic's mountain gets a watercolour wash for its outlook (warm ochre =
// hopeful, slate blue = worried, none = neutral), its hatching follows belief (bold and crisp for
// believers; thin, faded and broken for sceptics), and a divided topic's wash splits along the ridge,
// one camp's colour on each side, without blending.
//
// Underneath: the island hangs over empty paper as a mass of rock cut into strata, one band per past
// week (thicker = busier), with older bedrock below. Later: long-lived topics as seams through the
// strata (history), and roots between towns that talk to each other (interactions).
//
// Drawing: only what carries meaning. The ground is flat, so all relief is topics; mountains are drawn
// with an outline and hatching on the slopes turned from the light (cross-hatched where darkest); only
// towns are dots.
// Everything is paper or ink; there is no colour.

const PAPER = new THREE.Color('#f7f6f2');
const INK = new THREE.Color('#141414');
const COAST = 0.45; // land/town density at the coastline
const BORDER_REACH = 22; // group borders are only drawn this close to a town
const topicSigma = (h) => 3.2 + h * 0.2; // a mountain's width for its height
// Mountain height from a topic's reach: how many different accounts discussed it × its engagement
// (the same score that ranks topics), spread over 5–36 so big and small topics differ clearly.
function topicHeights(topics) {
  const score = topics.map((t) => t.authors * Math.log10(1 + t.engagement));
  const lo = Math.min(...score);
  const hi = Math.max(...score);
  return score.map((v) => 5 + 31 * Math.pow((v - lo) / (hi - lo || 1), 0.8));
}
const TRAIL_POINTS = 48;
const CITIES = 12; // the biggest accounts get a ringed city mark instead of a dot
// SAMPLE: invented weekly activity, newest first, until real history exists. Each becomes a stratum.
const SAMPLE_WEEKS = [7, 5, 9, 4, 6, 11, 5, 8, 6, 7];
const LIGHT = new THREE.Vector3(-0.55, 0.75, 0.35).normalize();
const HOPEFUL = new THREE.Color('#d39b3f'); // watercolour ochre
const WORRIED = new THREE.Color('#4f74a3'); // watercolour slate blue
const SHORE_SAMPLES = 360;
const COAST_INSET = 6; // coast lettering runs this far inland from the shore
const LETTER_SIZE = 6;
const LETTER_STEP = 4.6; // world units between letter centres along the coast

// One letter as a texture, cached: italic serif capitals, ink on transparent.
const glyphs = new Map();
function glyphTexture(ch) {
  if (glyphs.has(ch)) return glyphs.get(ch);
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.font = 'italic 500 46px "EB Garamond", Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText(ch, size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  glyphs.set(ch, tex);
  return tex;
}

const STRATUM_SCALE = 0.9; // world units of depth per unit of activity

// A map symbol on transparent ground: a ringed dot for cities, a plain dot for towns, both with a
// paper halo so they read on top of hatching.
function markTexture(city) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const mid = size / 2;
  g.fillStyle = '#f7f6f2';
  g.beginPath();
  g.arc(mid, mid, city ? 30 : 24, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = g.strokeStyle = '#141414';
  if (city) {
    g.lineWidth = 5;
    g.beginPath();
    g.arc(mid, mid, 22, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(mid, mid, 10, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    g.arc(mid, mid, 15, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Shared by the top surface and the underside.
const surfaceVertex = /* glsl */ `
  attribute float aLand;
  attribute float aBorder;
  attribute vec3 aMood; // outlook (on this side of the ridge), belief, wash strength; zero off mountains
  attribute vec2 aGround; // the nearest group's outlook, and how strongly its land is washed
  varying vec3 vMood;
  varying vec2 vGround;
  varying float vLand;
  varying float vBorder;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vLand = aLand;
    vBorder = aBorder;
    vMood = aMood;
    vGround = aGround;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const inkHelpers = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uInk;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vLand;
  varying float vBorder;
  varying vec3 vMood;
  varying vec2 vGround;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;

  // An anti-aliased line wherever coord crosses a whole number, about px pixels wide.
  float lines(float coord, float px) {
    float d = abs(fract(coord - 0.5) - 0.5) / max(fwidth(coord), 1e-4);
    return 1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, d);
  }
  // Hatching at twice the base density, so belief can thin it out or fill it in without the lines
  // shifting: even lines are the base set, odd ones are added for believers, and every other even line is
  // dropped for sceptics.
  float hatch(float coord, float px, float extra, float drop) {
    float c = coord * 2.0;
    float idx = mod(floor(c + 0.5), 4.0);
    float keep = idx == 0.0 ? 1.0 : idx == 2.0 ? 1.0 - drop : extra;
    return lines(c, px) * keep;
  }
  // An anti-aliased line where v equals target.
  float isoline(float v, float target, float px) {
    float d = abs(v - target) / max(fwidth(v), 1e-4);
    return 1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, d);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float stipple(vec2 p, float cellSize, float radius, float keep) {
    vec2 cell = floor(p / cellSize);
    vec2 jitter = vec2(hash(cell), hash(cell + 7.3)) * 0.6 + 0.2;
    float d = length(fract(p / cellSize) - jitter);
    return (1.0 - smoothstep(radius, radius + fwidth(p.x) / cellSize * 1.2, d)) * step(1.0 - keep, hash(cell + 3.1));
  }
  vec4 finish(float ink) {
    ink *= 1.0 - smoothstep(uFogNear, uFogFar, vDepth);
    return vec4(mix(uPaper, uInk, ink), 1.0);
  }
  // Ink over a tinted paper (a watercolour wash), both fading into the paper with distance.
  vec4 finishOn(vec3 base, float ink) {
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    return vec4(mix(mix(base, uPaper, fog), uInk, ink * (1.0 - fog)), 1.0);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

const topFragment = /* glsl */ `
  ${inkHelpers}
  uniform vec3 uLight;
  uniform vec3 uHopeful;
  uniform vec3 uWorried;
  void main() {
    if (vLand < 0.5) discard;
    float y = vWorld.y;
    float ink = 0.0;
    float wash = vMood.z;

    // Belief sets the hatching: bold and dense for believers; thin, sparse, faded and broken for sceptics.
    float bn = (vMood.y + 1.0) * 0.5;
    float weight = bn < 0.5 ? mix(0.45, 1.0, bn * 2.0) : mix(1.0, 2.3, bn * 2.0 - 1.0);
    float strength = bn < 0.5 ? mix(0.25, 1.0, bn * 2.0) : 1.0;
    float gaps = mix(step(0.45, vnoise(vWorld.xz * 1.3)), 1.0, smoothstep(0.25, 0.45, bn));
    float px = mix(1.0, weight, wash);
    float hatchInk = mix(1.0, strength * gaps, wash);
    float extra = wash * smoothstep(0.5, 0.9, bn);
    float drop = wash * (1.0 - smoothstep(0.1, 0.5, bn));

    // Hatching where the slope turns from the light; cross-hatching where it's darkest.
    float shade = 1.0 - clamp(dot(normalize(vNormal), uLight), 0.0, 1.0);
    ink = max(ink, hatch((vWorld.x + vWorld.z) / 0.75, px, extra, drop) * smoothstep(0.42, 0.55, shade) * 0.8 * hatchInk);
    ink = max(ink, hatch((vWorld.x - vWorld.z) / 0.75, px, extra, drop) * smoothstep(0.62, 0.75, shade) * 0.8 * hatchInk);

    // Outlook: mottled watercolour washes, warm for hopeful, cool for worried. A faint one for each
    // group's land, and a stronger one for each topic's mountain on top.
    float mottle = 0.55 + 0.45 * vnoise(vWorld.xz * 0.35);
    vec3 groundColor = vGround.x >= 0.0 ? uHopeful : uWorried;
    vec3 base = mix(uPaper, groundColor, vGround.y * abs(vGround.x) * mottle * 0.4);
    vec3 washColor = vMood.x >= 0.0 ? uHopeful : uWorried;
    base = mix(base, washColor, wash * abs(vMood.x) * mottle * 0.85);

    // Dashed group borders.
    float border = 1.0 - smoothstep(1.2, 1.2 + fwidth(vBorder) * 1.5, vBorder);
    float dash = step(0.45, fract((vWorld.x * 0.6 + vWorld.z * 0.8) / 1.6));
    ink = max(ink, border * dash * 0.9);

    // The island's edge, drawn bold.
    ink = max(ink, isoline(vLand, 0.5, 2.2));
    gl_FragColor = finishOn(base, ink);
  }
`;

const STRATA = SAMPLE_WEEKS.length;
const undersideFragment = /* glsl */ `
  ${inkHelpers}
  uniform float uStrata[${STRATA}]; // depth of each stratum's lower boundary, newest first
  void main() {
    if (vLand < 0.5) discard;
    float depth = -vWorld.y;
    float ink = 0.0;

    // Strata boundaries, and which stratum this point is in (${STRATA} = bedrock below them all).
    int layer = ${STRATA};
    for (int k = 0; k < ${STRATA}; k++) {
      ink = max(ink, isoline(depth, uStrata[k], 1.3) * 0.9);
      if (layer == ${STRATA} && depth < uStrata[k]) layer = k;
    }
    // Each stratum gets its own texture so neighbouring weeks read apart; bedrock is dense.
    if (layer == ${STRATA}) {
      ink = max(ink, lines((vWorld.x + vWorld.z) / 1.1, 1.0) * 0.45);
    } else if (layer - (layer / 3) * 3 == 0) {
      ink = max(ink, lines(depth / 1.1, 1.0) * 0.25);
    } else if (layer - (layer / 3) * 3 == 1) {
      ink = max(ink, stipple(vec2(vWorld.x + vWorld.z, depth), 1.2, 0.1, 0.55) * 0.7);
    }

    ink = max(ink, isoline(vLand, 0.5, 2.2));
    gl_FragColor = finish(ink);
  }
`;

// Each topic is a small mountain range rather than a cone: a main summit at the topic's height (its
// buzz), lower shoulder peaks along a ridge in a random direction, slightly stretched along that ridge,
// with gullies cut into the slopes. Ranges are combined by taking the highest value at each vertex.
// `owner` records which topic's range is highest at each vertex, and `across` which side of that
// range's ridge it's on (negative / positive), for mood washes that follow each topic.
function stampRanges(mtn, peaks, heights, sigma, owner, across) {
  const rand = mulberry32(5);
  peaks.forEach((p, t) => {
    const H = heights[t];
    const s = sigma(H);
    const ang = rand() * Math.PI;
    const ax = Math.cos(ang);
    const az = Math.sin(ang);
    const summits = [{ along: 0, across: 0, h: H, s }];
    const shoulders = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < shoulders; k++) {
      const side = k % 2 ? 1 : -1;
      summits.push({
        along: side * (0.6 + rand() * 0.8) * s,
        across: (rand() - 0.5) * 0.6 * s,
        h: H * (0.35 + rand() * 0.4),
        s: s * (0.5 + rand() * 0.3),
      });
    }
    const R = s * 3.2;
    const ix0 = Math.max(0, Math.floor((p.x - R + HALF) / STEP));
    const ix1 = Math.min(SEG, Math.ceil((p.x + R + HALF) / STEP));
    const iz0 = Math.max(0, Math.floor((p.z - R + HALF) / STEP));
    const iz1 = Math.min(SEG, Math.ceil((p.z + R + HALF) / STEP));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = ix * STEP - HALF - p.x;
        const dz = iz * STEP - HALF - p.z;
        const along = dx * ax + dz * az;
        const side = -dx * az + dz * ax;
        let val = 0;
        for (const m of summits) {
          // Stretched along the ridge: distance across the ridge counts more.
          const d = Math.hypot((along - m.along) / 1.35, side - m.across);
          val = Math.max(val, m.h * Math.exp(-Math.pow(d / m.s, 1.4)));
        }
        // Gullies: ridged noise eats into the slopes, but not the summit.
        const r = Math.hypot(dx, dz) / s;
        const gully = 1 - Math.abs(fbm(dx * 0.18 + t * 13.1, dz * 0.18 + t * 7.7, 3) * 2 - 1);
        val *= 1 - 0.35 * gully * smoothstep(0.25, 0.9, r);
        const v = iz * (SEG + 1) + ix;
        if (val > mtn[v]) {
          mtn[v] = val;
          owner[v] = t;
          across[v] = side;
        }
      }
    }
  });
}

// A surface pushed out along its normals, drawn on the faces turned away from the camera: an ink
// line around silhouettes (the mountains' edges and ridges, the underside's outline).
const silhouetteVertex = /* glsl */ `
  uniform float uThickness;
  attribute float aLand;
  varying float vLand;
  varying float vDepth;
  void main() {
    vLand = aLand;
    vec4 mv = viewMatrix * modelMatrix * vec4(position + normal * uThickness, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const silhouetteFragment = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uInk;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vLand;
  varying float vDepth;
  void main() {
    if (vLand < 0.5) discard;
    gl_FragColor = vec4(mix(uInk, uPaper, smoothstep(uFogNear, uFogFar, vDepth)), 1.0);
  }
`;

// Distance (world units) from every land vertex to the coast: a two-pass chamfer transform on the grid.
function distanceToCoast(land) {
  const S = SEG + 1;
  const d = new Float32Array(S * S);
  for (let v = 0; v < d.length; v++) d[v] = land[v] >= 0.5 ? Infinity : 0;
  const diag = STEP * Math.SQRT2;
  const relax = (v, u, cost) => {
    if (d[u] + cost < d[v]) d[v] = d[u] + cost;
  };
  for (let k = 0; k < S; k++) {
    for (let i = 0; i < S; i++) {
      const v = k * S + i;
      if (i > 0) relax(v, v - 1, STEP);
      if (k > 0) relax(v, v - S, STEP);
      if (i > 0 && k > 0) relax(v, v - S - 1, diag);
      if (i < S - 1 && k > 0) relax(v, v - S + 1, diag);
    }
  }
  for (let k = S - 1; k >= 0; k--) {
    for (let i = S - 1; i >= 0; i--) {
      const v = k * S + i;
      if (i < S - 1) relax(v, v + 1, STEP);
      if (k < S - 1) relax(v, v + S, STEP);
      if (i < S - 1 && k < S - 1) relax(v, v + S + 1, diag);
      if (i > 0 && k < S - 1) relax(v, v + S - 1, diag);
    }
  }
  return d;
}

export function createInk({ accounts, topics, regions, participation, moods: groupMoods, showQuiet = false, focus = 'all' }) {
  const group = new THREE.Group();
  const nA = accounts.length;
  const { interests, participants } = participation;
  // Topic heights stay on the buzz scale; the size toggle only resizes towns.
  const topicH = topicHeights(topics);
  const { towns, peaks, density, groupCentres } = atlasLayout({
    accounts,
    topics,
    interests,
    participants,
    regions,
    topicSigma,
    topicHeights: topicH,
    coast: COAST,
  });
  const topicsOf = accounts.map((_, a) => topics.map((_, t) => t).filter((t) => participants[t].includes(a)));

  // How much further the nearest town of another group is than the nearest town (0 on a border),
  // only near towns so borders don't run on across empty land; and which group that nearest town is in.
  let nearestGroup = -1;
  let nearestDist = Infinity;
  function borderGap(x, z) {
    let best = Infinity;
    let bestGroup = -1;
    let other = Infinity;
    const d = towns.map((p) => (p.quiet ? Infinity : Math.hypot(p.x - x, p.z - z)));
    d.forEach((dist, i) => {
      if (dist < best) (best = dist), (bestGroup = towns[i].group);
    });
    nearestGroup = bestGroup;
    nearestDist = best;
    d.forEach((dist, i) => {
      if (towns[i].group !== bestGroup && dist < other) other = dist;
    });
    return best < BORDER_REACH ? other - best : 99;
  }

  // --- Top surface ----------------------------------------------------------

  const top = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  top.rotateX(-Math.PI / 2);
  const pos = top.attributes.position;
  const N = pos.count;
  const land = new Float32Array(N);
  const border = new Float32Array(N);
  const mtn = new Float32Array(N);
  const owner = new Int16Array(N).fill(-1);
  const across = new Float32Array(N);
  stampRanges(mtn, peaks, topicH, topicSigma, owner, across);
  // Each topic's mood as drawn: the focus neutralises the other axes; 'off' draws none.
  const moods = topics.map((t) => (focus === 'off' || !t.mood ? null : effectiveMood(t.mood, focus)));
  const sides = moods.map((m) => (m ? lobeOutlooks(m) : null));
  const mood = new Float32Array(N * 3);
  const ground = new Float32Array(N * 2);
  // Each group's outlook as drawn (the ground wash only shows outlook).
  const groundOutlook = regions.map((r) => {
    const m = focus === 'off' || focus === 'belief' || !groupMoods?.[r.id] ? null : effectiveMood(groupMoods[r.id], focus);
    return m ? m.outlook : 0;
  });
  for (let v = 0; v < N; v++) {
    const x = pos.getX(v);
    const z = pos.getZ(v);
    land[v] = smoothstep(COAST - 0.15, COAST + 0.15, density(x, z));
    // Flat ground at y = 0.4 (so the lowest contour isn't drawn); only topic mountains rise from it.
    pos.setY(v, 0.4 * smoothstep(0.5, 1, land[v]) + mtn[v] * smoothstep(0.4, 0.6, land[v]));
    border[v] = land[v] > 0.6 ? borderGap(x, z) : 99;
    if (land[v] > 0.6 && nearestGroup >= 0) {
      // Strongest among a group's towns, fading out over open land.
      ground.set([groundOutlook[nearestGroup], 1 - smoothstep(14, 30, nearestDist)], v * 2);
    }
    const t = owner[v];
    if (t >= 0 && moods[t]) {
      // The wash covers the mountain's body (fading out over its foothills); a divided topic shows each
      // camp's outlook on its own side of the ridge.
      const wash = smoothstep(0.06, 0.3, mtn[v] / topicH[t]) * smoothstep(0.5, 0.7, land[v]);
      mood.set([across[v] >= 0 ? sides[t][0] : sides[t][1], moods[t].belief, wash], v * 3);
    }
  }
  top.setAttribute('aLand', new THREE.BufferAttribute(land, 1));
  top.setAttribute('aMood', new THREE.BufferAttribute(mood, 3));
  top.setAttribute('aGround', new THREE.BufferAttribute(ground, 2));
  top.setAttribute('aBorder', new THREE.BufferAttribute(border, 1));
  top.computeVertexNormals();

  // --- Underside: deepest under the island's interior, lumpy, with a few hanging spurs ----------

  const coastDist = distanceToCoast(land);
  const under = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  under.rotateX(-Math.PI / 2);
  const upos = under.attributes.position;
  for (let v = 0; v < N; v++) {
    const d = coastDist[v];
    if (!(d > 0) || !isFinite(d)) continue; // off the island: discarded anyway
    const x = upos.getX(v);
    const z = upos.getZ(v);
    const lumps = (fbm(x * 0.05 + 80, z * 0.05 + 80, 4) - 0.5) * 14 * smoothstep(0, 12, d);
    const spurs = Math.pow(fbm(x * 0.09 + 20, z * 0.09 + 20, 3), 3) * 34 * smoothstep(4, 20, d);
    upos.setY(v, -Math.max(0, Math.pow(d, 0.9) * 1.1 + lumps + spurs));
  }
  under.setAttribute('aLand', new THREE.BufferAttribute(land, 1));
  under.setAttribute('aBorder', new THREE.BufferAttribute(new Float32Array(N).fill(99), 1));
  under.computeVertexNormals();
  // Point the normals out of the rock (down), so the silhouette pushes outward.
  const un = under.attributes.normal;
  for (let k = 0; k < un.array.length; k++) un.array[k] = -un.array[k];

  let acc = 0;
  const strata = SAMPLE_WEEKS.map((w) => (acc += w * STRATUM_SCALE));

  // --- Materials ------------------------------------------------------------

  const shared = {
    uPaper: { value: PAPER },
    uInk: { value: INK },
    uFogNear: { value: 300 },
    uFogFar: { value: 720 },
  };
  const terrain = new THREE.Mesh(
    top,
    new THREE.ShaderMaterial({
      uniforms: { ...shared, uLight: { value: LIGHT }, uHopeful: { value: HOPEFUL }, uWorried: { value: WORRIED } },
      vertexShader: surfaceVertex,
      fragmentShader: topFragment,
    })
  );
  group.add(terrain);
  group.add(
    new THREE.Mesh(
      under,
      new THREE.ShaderMaterial({
        uniforms: { ...shared, uStrata: { value: strata } },
        vertexShader: surfaceVertex,
        fragmentShader: undersideFragment,
        side: THREE.DoubleSide,
      })
    )
  );
  const silhouette = (geo, thickness, side) =>
    new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { ...shared, uThickness: { value: thickness } },
        vertexShader: silhouetteVertex,
        fragmentShader: silhouetteFragment,
        side,
      })
    );
  group.add(silhouette(top, 0.22, THREE.BackSide));
  // The underside's normals point down out of the rock, so its turned-away faces are the front faces.
  group.add(silhouette(under, 0.18, THREE.FrontSide));

  // Ground height anywhere on the map, interpolated from the grid.
  function heightAt(x, z) {
    const fx = Math.min(SEG - 1e-3, Math.max(0, (x + HALF) / STEP));
    const fz = Math.min(SEG - 1e-3, Math.max(0, (z + HALF) / STEP));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const y = (i, k) => pos.getY(k * (SEG + 1) + i);
    return (y(ix, iz) * (1 - tx) + y(ix + 1, iz) * tx) * (1 - tz) + (y(ix, iz + 1) * (1 - tx) + y(ix + 1, iz + 1) * tx) * tz;
  }

  const peakY = peaks.map((p) => heightAt(p.x, p.z));

  // --- Group names lettered along the coast ------------------------------------
  // Each group's name is printed flat on the land just inside the coast, centred on the direction of its
  // towns, one letter at a time following the shoreline, every letter's top toward the island's interior.

  const middle = { x: 0, z: 0 };
  const activeTowns = towns.filter((t) => !t.quiet);
  for (const t of activeTowns) (middle.x += t.x / activeTowns.length), (middle.z += t.z / activeTowns.length);
  // The shore's distance from an origin all the way round, smoothed so lettering follows the coast's
  // shape without every small wiggle: the outermost land seen from the island's middle, or, around a
  // group on an islet of its own, the first water out from that group's centre.
  function makeShore(origin, firstWater) {
    const raw = Array.from({ length: SHORE_SAMPLES }, (_, k) => {
      const a = (k / SHORE_SAMPLES) * Math.PI * 2;
      let r = 0;
      for (let probe = 0; probe < 260; probe += 1) {
        const onLand = density(origin.x + Math.cos(a) * probe, origin.z + Math.sin(a) * probe) >= COAST;
        if (onLand) r = probe;
        else if (firstWater && probe > 0) break;
      }
      return r;
    });
    const shoreR = raw.map((_, k) => {
      let sum = 0;
      for (let d = -6; d <= 6; d++) sum += raw[(k + d + SHORE_SAMPLES) % SHORE_SAMPLES];
      return sum / 13;
    });
    const radiusAt = (a) => {
      const f = ((((a / (Math.PI * 2)) % 1) + 1) % 1) * SHORE_SAMPLES;
      const k = Math.floor(f);
      return shoreR[k % SHORE_SAMPLES] * (1 - (f - k)) + shoreR[(k + 1) % SHORE_SAMPLES] * (f - k);
    };
    return { origin, radiusAt };
  }
  const mainShore = makeShore(middle, false);

  const letterGeo = new THREE.PlaneGeometry(LETTER_SIZE, LETTER_SIZE);
  const basis = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);
  // Where a name's letters go if centred at angle aCentre: positions along the coast just inland, each
  // with its "up" (into the land) and "right" (reading direction), plus the angles the name spans.
  function layoutName(chars, aCentre, shore = mainShore) {
    const { origin, radiusAt } = shore;
    const path = [];
    for (let s = -1.8; s <= 1.8; s += 0.003) {
      const a = aCentre + s;
      const rr = radiusAt(a) - COAST_INSET;
      const p = { x: origin.x + Math.cos(a) * rr, z: origin.z + Math.sin(a) * rr, len: 0, s };
      if (path.length) p.len = path.at(-1).len + Math.hypot(p.x - path.at(-1).x, p.z - path.at(-1).z);
      path.push(p);
    }
    const centre = path.find((p) => p.s >= 0).len;
    const letters = chars.map((ch, k) => {
      // With tops toward the land, text reads in the direction of decreasing angle around the island.
      let i = path.findIndex((p) => p.len >= centre - (k - (chars.length - 1) / 2) * LETTER_STEP);
      if (i < 0) i = path.length - 1;
      const p = path[i];
      const q = path[Math.min(path.length - 1, i + 1)];
      const o = path[Math.max(0, i - 1)];
      const t = new THREE.Vector3(q.x - o.x, 0, q.z - o.z).normalize();
      const u = new THREE.Vector3(-t.z, 0, t.x);
      if (u.x * (origin.x - p.x) + u.z * (origin.z - p.z) < 0) u.negate();
      // The smoothed coast can cut across a bay: step inland until the letter is on land.
      let x = p.x;
      let z = p.z;
      for (let step = 0; step < 30 && density(x, z) < COAST + 0.1; step++) (x += u.x), (z += u.z);
      return { ch, x, z, up: u, right: new THREE.Vector3(-u.z, 0, u.x), s: p.s };
    });
    return { letters, from: aCentre + Math.min(...letters.map((l) => l.s)), to: aCentre + Math.max(...letters.map((l) => l.s)) };
  }

  const nearestActiveGroup = (x, z) => {
    let best = Infinity;
    let group = -1;
    for (const t of activeTowns) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < best) (best = d), (group = t.group);
    }
    return group;
  };

  // Each name takes the stretch of coast near its group that's flattest (mountains would hide letters) and
  // most its own (nearest to its towns rather than another group's), without overlapping a name placed
  // before it; groups with more active towns choose first.
  const taken = [];
  const overlaps = (from, to) =>
    taken.some(([f, t]) => {
      const gap = 0.06;
      for (const shift of [-Math.PI * 2, 0, Math.PI * 2]) if (from < t + shift + gap && to > f + shift - gap) return true;
      return false;
    });
  const activeCount = (id) => activeTowns.filter((t) => regions[t.group].id === id).length;
  const coastNames = regions
    .filter((r) => groupCentres[r.id])
    .sort((a, b) => activeCount(b.id) - activeCount(a.id))
    .map((r) => {
      const c = groupCentres[r.id];
      const a0 = Math.atan2(c.z - middle.z, c.x - middle.x);
      const chars = [...r.label.toUpperCase()];
      let best = null;
      for (let off = -1.2; off <= 1.2; off += 0.04) {
        const cand = layoutName(chars, a0 + off);
        if (overlaps(cand.from, cand.to)) continue;
        // Every letter on land: where the land breaks into islets the traced shoreline crosses water.
        if (cand.letters.some((l) => l.ch !== ' ' && density(l.x, l.z) < COAST)) continue;
        const relief = cand.letters.reduce((m, l) => Math.max(m, heightAt(l.x, l.z)), 0);
        // Share of letters whose nearest town is in another group: a name belongs on its own group's coast.
        const g = regions.indexOf(r);
        const foreign = cand.letters.filter((l) => nearestActiveGroup(l.x, l.z) !== g).length / cand.letters.length;
        const score = relief * 3 + Math.abs(off) * 6 + foreign * 12;
        if (!best || score < best.score) best = { ...cand, score };
      }
      if (best) taken.push([best.from, best.to]);
      else {
        // No stretch of the main coast fits (the group may sit on an islet of its own): try the coast
        // around the group's own land, flattest first.
        const shore = makeShore(c, true);
        for (let a = -Math.PI; a < Math.PI; a += 0.08) {
          const cand = layoutName(chars, a, shore);
          if (cand.letters.some((l) => l.ch !== ' ' && density(l.x, l.z) < COAST)) continue;
          const relief = cand.letters.reduce((m, l) => Math.max(m, heightAt(l.x, l.z)), 0);
          if (!best || relief < best.score) best = { ...cand, score: relief };
        }
      }
      if (!best) return null; // nowhere fits: the legend still names the group
      const sprites = best.letters.map((l) => {
        const letter = new THREE.Mesh(
          letterGeo,
          new THREE.MeshBasicMaterial({
            map: glyphTexture(l.ch),
            color: INK,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        );
        letter.quaternion.setFromRotationMatrix(basis.makeBasis(l.right, l.up, UP));
        letter.position.set(l.x, heightAt(l.x, l.z) + 0.25, l.z);
        letter.visible = l.ch !== ' ';
        group.add(letter);
        return letter;
      });
      return { id: r.id, sprites };
    })
    .filter(Boolean);

  const townY = towns.map((p) => heightAt(p.x, p.z));

  // --- Towns ----------------------------------------------------------------

  const cityTex = markTexture(true);
  const townTex = markTexture(false);
  // Accounts that didn't post about AI in the data window are quiet: small, faint dots, shown only
  // when asked for.
  const quiet = towns.map((t) => !!t.quiet);
  const shown = (i) => !quiet[i] || showQuiet;
  const marks = towns.map((p, i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: townTex, depthWrite: false }));
    sprite.position.set(p.x, townY[i] + 0.6, p.z);
    sprite.renderOrder = 2;
    sprite.visible = shown(i);
    group.add(sprite);
    return sprite;
  });
  const townSize = new Float32Array(nA);

  // --- Trails: dashed ink paths draped over the ground, rebuilt on hover --------

  const trails = new THREE.Group();
  group.add(trails);
  const trailMat = new THREE.LineDashedMaterial({ color: INK, dashSize: 0.9, gapSize: 0.6, depthTest: false });
  function trail(from, to) {
    const pts = [];
    for (let k = 0; k < TRAIL_POINTS; k++) {
      const f = k / (TRAIL_POINTS - 1);
      const x = from.x + (to.x - from.x) * f;
      const z = from.z + (to.z - from.z) * f;
      pts.push(new THREE.Vector3(x, heightAt(x, z) + 0.35, z));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), trailMat);
    line.computeLineDistances();
    line.renderOrder = 1;
    trails.add(line);
  }
  let emphasis = [];
  let connected = null; // towns that stay dark while connections show; null = all
  function setHovered(i) {
    for (const line of trails.children) line.geometry.dispose();
    trails.clear();
    emphasis = [];
    connected = null;
    if (i >= 0 && i < nA) {
      for (const t of topicsOf[i]) trail(towns[i], peaks[t]);
      emphasis = topicsOf[i].map((t) => nA + t);
      connected = new Set([i]);
    } else if (i >= nA) {
      const t = i - nA;
      for (const a of participants[t]) trail(towns[a], peaks[t]);
      emphasis = participants[t];
      connected = new Set(participants[t]);
    }
    applySelection();
  }

  // Selected groups (from the legend): other groups' towns and coast lettering fade back. While
  // connections show, towns outside them fade too.
  let selection = null;
  function applySelection() {
    marks.forEach((m, i) => {
      const inGroup = !selection || selection.has(regions[towns[i].group].id);
      const linked = !connected || connected.has(i);
      m.material.opacity = (quiet[i] ? 0.4 : 1) * (inGroup && linked ? 1 : 0.15);
    });
    for (const name of coastNames) {
      const on = !selection || selection.has(name.id);
      for (const sprite of name.sprites) sprite.material.opacity = on ? 1 : 0.2;
    }
  }
  function setGroupFilter(groups) {
    selection = groups;
    applySelection();
  }

  function setHeights(h) {
    const ranked = [...Array(nA).keys()].sort((a, b) => h[b] - h[a]);
    const cities = new Set(ranked.slice(0, CITIES));
    marks.forEach((m, i) => {
      townSize[i] = quiet[i] ? 1.2 : 1.8 + ((h[i] - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT)) * 2.8;
      m.scale.setScalar(townSize[i]);
      m.material.transparent = true;
      m.material.map = cities.has(i) ? cityTex : townTex;
    });
    applySelection();
  }

  return {
    group,
    background: '#f7f6f2',
    toneMapping: THREE.NoToneMapping,
    // Allow tilting a little below the horizon to see the island's underside; start from a raised
    // three-quarter view where the coast lettering reads.
    maxPolarAngle: Math.PI * 0.62,
    cameraHome: [-32, 140, 204], // a little closer than the whole island with margin, so it fills more of the screen
    setHeights,
    setHovered,
    setGroupFilter,
    // Items to label while something is hovered: its trail partners.
    emphasis: () => emphasis,
    // Whether an item is on the map at all (hidden quiet towns get no label).
    isShown: (i) => i >= nA || shown(i),
    anchor(i, out) {
      if (i < nA) return out.set(towns[i].x, townY[i] + 0.6 + townSize[i] * 0.6, towns[i].z);
      const t = i - nA;
      return out.set(peaks[t].x, peakY[t] + 4, peaks[t].z); // a little above the summit, for the plate
    },
    pick(raycaster) {
      const hit = raycaster.intersectObject(terrain)[0];
      if (!hit || density(hit.point.x, hit.point.z) < COAST) return -1;
      let best = -1;
      let bestD = Infinity;
      towns.forEach((p, i) => {
        if (!shown(i)) return;
        const d = Math.hypot(hit.point.x - p.x, hit.point.z - p.z);
        if (d < Math.max(1.4, townSize[i] * 0.8) && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) return best;
      const t = peakAt(hit.point, peaks, topicH, topicSigma);
      return t >= 0 ? nA + t : -1;
    },
  };
}
