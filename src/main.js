import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { ACCOUNTS, REGIONS, DATA_WINDOW } from './data/accounts.js';
import { MOODS } from './data/moods.js';
import { TOPICS } from './data/topics.js';
import { interests, participants } from './data/participation.js';
import { DATASET, has, SOURCES, SOURCE, NICHE, NICHE_AVAILABLE } from './data/atlas.js';
import { describeMood } from './mood.js';
import { postLink, shortCount, sourceLabel } from './posts.js';
import { computeHeights, MIN_HEIGHT, MAX_HEIGHT } from './scale.js';
import { disposeTree } from './lib/three-utils.js';
import { createInk } from './modes/ink.js';

// --- Renderer, camera, controls -------------------------------------------

const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'label-layer';
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 3000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 30;
controls.maxDistance = 480;

// The ink shaders output linear colour; the output pass converts it for the screen.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());

// --- State -----------------------------------------------------------------

const regionById = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const params = new URLSearchParams(location.search);

let moodFocus = params.get('mood') ?? 'all'; // 'off', 'all' or one axis: 'outlook', 'belief', 'division'
// Towns are the accounts that posted about AI in the window; ?towns=all also shows the quiet ones.
const townsShown = params.get('towns') === 'all' ? 'all' : 'active';
// Groups picked in the legend; empty = all. ?groups=safety,research in the URL preselects some.
const selectedGroups = new Set((params.get('groups') ?? '').split(',').filter(Boolean));
// Town sizes: an account's standing across platforms ('combined'), or its followers on the platform the map
// is showing; ?size=github (or followers, bluesky, huggingface, papers, tweets) sizes by one platform.
const metric = ['followers', 'bluesky', 'github', 'huggingface', 'papers', 'tweets', 'combined'].includes(params.get('size'))
  ? params.get('size')
  : SOURCE === 'bluesky' ? 'bluesky' : SOURCE === 'x' ? 'followers' : 'combined';
let active = null;
let hovered = -1;
let plateHover = -1; // a topic plate under the pointer, which wins over the 3D scene
// A clicked item: its card stays in the detail panel and its trails stay drawn. The card is modal: the
// map ignores hover until a click outside the card (or ×, or Esc) closes it, except for the items
// connected to it (a topic's accounts, an account's topics), which can still be hovered and clicked.
let pinned = -1;
let lastFocus = -1;
// What the map is showing details for: what's under the pointer, else the pinned item.
const focusOf = () => (hovered >= 0 ? hovered : pinned);
const moodShown = () => moodFocus !== 'off';

// "Posts from X and Bluesky, 29–30 Oct 2026": where the data comes from, for the footnote.
const fmtDay = (iso, opts) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', ...opts });
const platformNames = { x: 'X', bluesky: 'Bluesky' };
const postsFrom = SOURCE ? platformNames[SOURCE] : SOURCES.length ? SOURCES.map((p) => platformNames[p]).join(' and ') : 'X';
const DATA_NOTE = `Posts from ${postsFrom}, ${fmtDay(DATA_WINDOW.from)}–${fmtDay(DATA_WINDOW.to, { month: 'short', year: 'numeric' })}`;

// --- Sources: X, Bluesky, GitHub, Hugging Face, papers -----------------------------------------------

// An account's reach on each platform (0 where it has no account there), each in its own numbers.
const reach = {
  followers: (a) => a.followers ?? 0,
  bluesky: (a) => a.bluesky?.followers ?? 0,
  github: (a) => a.github?.stars ?? 0,
  huggingface: (a) => a.huggingface?.followers ?? 0,
  papers: (a) => a.papers?.citations ?? 0,
};

// Percentile of each account's reach on a platform, among the accounts on that platform (null if absent).
function percentiles(value) {
  const present = ACCOUNTS.map((a, i) => [value(a), i]).filter(([v]) => v > 0);
  present.sort((p, q) => p[0] - q[0]);
  const out = new Array(ACCOUNTS.length).fill(null);
  present.forEach(([, i], rank) => (out[i] = present.length > 1 ? rank / (present.length - 1) : 1));
  return out;
}
const sourcePercentiles = Object.fromEntries(Object.entries(reach).map(([k, f]) => [k, percentiles(f)]));

// Combined standing: the best percentile on any platform, plus a little for each other platform where the
// account is in the top half — so people who live on one platform aren't penalised.
const combinedScore = ACCOUNTS.map((_, i) => {
  const ps = Object.values(sourcePercentiles)
    .map((list) => list[i])
    .filter((p) => p != null);
  if (!ps.length) return 0;
  const best = Math.max(...ps);
  const extras = ps.filter((p) => p >= 0.5).length - (best >= 0.5 ? 1 : 0);
  return Math.min(1, best + 0.05 * extras);
});


function accountHeights(m) {
  if (m === 'combined') return combinedScore.map((v) => MIN_HEIGHT + v * (MAX_HEIGHT - MIN_HEIGHT));
  if (reach[m]) return computeHeights(ACCOUNTS.map((a) => ({ v: reach[m](a) })), 'v');
  return computeHeights(ACCOUNTS, m);
}

// --- Items: towns (accounts, indices 0…n-1) and topic mountains (n…n+t-1) ---------------------------

// Test modes, to see how a polarised window would look: ?test=belief spreads topic beliefs evenly from -1
// to 1, keeping their order; ?test=belief-extremes puts the lower half at -1 and the upper half at 1.
if (params.get('test')?.startsWith('belief')) {
  const extremes = params.get('test') === 'belief-extremes';
  [...TOPICS].sort((a, b) => a.mood.belief - b.mood.belief).forEach((t, i, all) => {
    t.mood.belief = extremes ? (i < all.length / 2 ? -1 : 1) : -1 + (2 * i) / (all.length - 1);
  });
}

const nA = ACCOUNTS.length;
const ITEMS = [...ACCOUNTS.map((a) => ({ ...a, kind: 'account' })), ...TOPICS.map((t) => ({ ...t, kind: 'topic' }))];
// Town sizes follow the toggle; mountains always follow buzz.
const heightsFor = (m) => [...accountHeights(m), ...computeHeights(TOPICS, 'engagement')];
let target = heightsFor(metric);
let current = target.slice();

// A search for a topic on the platform the map is showing (X unless it's the Bluesky view).
const urlFor = (item) =>
  SOURCE === 'bluesky'
    ? `https://bsky.app/search?q=${encodeURIComponent(item.query ?? item.name)}`
    : `https://x.com/search?q=${encodeURIComponent(item.query ?? item.name)}&f=top`;

// All mountains are named; only a few towns at the default view, more as the camera comes closer.
function labelOrder(heights, distance) {
  const towns = ACCOUNTS.map((_, i) => i).sort((a, b) => heights[b] - heights[a]);
  const shown = Math.round(6 + (towns.length - 6) * Math.min(1, Math.max(0, (260 - distance) / 200)) ** 2);
  return [...TOPICS.map((_, t) => nA + t), ...towns.slice(0, shown)];
}

// --- Cards ------------------------------------------------------------------------------------------

// A bar filled from `from` to `to` (both 0–1 along the track). Two-sided scales (starting from the middle)
// get a centre tick; division runs one way, from agreed, so it has none.
const moodBar = (low, high, from, to) => `<div class="tt-bar-row">
    <span>${low}</span><span class="tt-bar${from === 0.5 ? ' centred' : ''}"><i style="left:${Math.min(from, to) * 100}%;width:${Math.abs(to - from) * 100}%"></i></span><span>${high}</span>
  </div>`;

function moodBars(m) {
  if (m.scored === 0)
    return `<div class="tt-mood"><div class="tt-mood-title">Mood · no post took a stance yet (news and links)</div></div>`;
  return `<div class="tt-mood">
    <div class="tt-mood-title">Mood</div>
    ${moodBar('Worried', 'Hopeful', 0.5, (m.outlook + 1) / 2)}
    ${moodBar('Sceptics', 'Believers', 0.5, (m.belief + 1) / 2)}
    ${moodBar('Agreed', 'Divided', 0, m.division)}
  </div>`;
}

// An account's own mood, from its stance-taking posts in the data window.
function accountMoodBars(m) {
  return `<div class="tt-mood">
    <div class="tt-mood-title">Mood · from ${m.scored} posts</div>
    ${moodBar('Worried', 'Hopeful', 0.5, (m.outlook + 1) / 2)}
    ${moodBar('Sceptics', 'Believers', 0.5, (m.belief + 1) / 2)}
  </div>`;
}

// For a divided topic: who is in each camp and how that camp feels.
function campRows(m) {
  if (!m.camps) return '';
  return `<div class="tt-camps">${m.camps
    .map(
      ([outlook, groups]) => `<div class="tt-camp">
        <span>${groups.map((id) => regionById[id]?.label ?? id).join(', ')}</span>
        <b>${outlook > 0.35 ? 'hopeful' : outlook < -0.35 ? 'worried' : 'mixed'}</b>
      </div>`
    )
    .join('')}</div>`;
}

// GitHub / Hugging Face / papers lines for an account's card.
// Where an account is, one row per platform: name (a link out), handle, and its numbers there. X is one
// platform among others: an account may be on Bluesky alone.
function platformRows(a) {
  const n = (x) => `<b>${compact.format(x ?? 0)}</b>`;
  const row = (label, url, handle, stats) =>
    `<div class="tt-platform"><a href="${url}" target="_blank" rel="noopener">${label}</a>` +
    `<div>${handle ? `<span class="tt-at">${handle}</span>` : ''}<span>${stats}</span></div></div>`;
  const rows = [];
  if (a.followers != null) rows.push(row('X', `https://x.com/${a.handle}`, `@${a.handle}`, `${n(a.followers)} followers · ${n(a.tweets)} posts`));
  if (a.bluesky)
    rows.push(row('Bluesky', `https://bsky.app/profile/${a.bluesky.handle}`, `@${a.bluesky.handle}`, `${n(a.bluesky.followers)} followers · ${n(a.bluesky.posts)} posts`));
  if (a.github)
    rows.push(row('GitHub', `https://github.com/${a.github.login}`, a.github.login, `${n(a.github.followers)} followers · ${n(a.github.stars)} stars`));
  if (a.huggingface)
    rows.push(row('Hugging Face', `https://huggingface.co/${a.huggingface.username}`, a.huggingface.username, `${n(a.huggingface.followers)} followers · ${n(a.huggingface.models)} models`));
  if (a.papers)
    rows.push(row('Papers', `https://openalex.org/${a.papers.openalex}`, '', `${n(a.papers.citations)} citations · h-index <b>${a.papers.hIndex}</b>`));
  return `<div class="tt-platforms">${rows.join('')}</div>`;
}

function accountMood(a) {
  if (!moodShown()) return '';
  if (a.mood) return accountMoodBars(a.mood);
  if (!a.aiPosts) return '';
  return `<div class="tt-mood"><div class="tt-mood-title">Mood · too few stance-taking posts (${a.aiPosts} AI ${
    a.aiPosts === 1 ? 'post' : 'posts'
  })</div></div>`;
}

const accountCard = (a) => `
  <div class="tt-name">${a.name}</div>
  <div class="tt-region">${regionById[a.region].label}</div>
  ${platformRows(a)}
  ${accountMood(a)}`;

const topicCard = (t, links = '') => `
  <div class="tt-name">${t.name}</div>
  <div class="tt-summary">${t.summary}</div>
  ${links}
  <div class="tt-stats">
    <div><b>${compact.format(t.engagement)}</b><span>engagement</span></div>
    <div><b>${compact.format(t.tweets)}</b><span>posts</span></div>
  </div>
  ${moodShown() ? moodBars(t.mood) + campRows(t.mood) : ''}
  <div class="tt-groups">${t.groups
    .map(([id, share]) => `<div class="tt-group"><span>${regionById[id].label}</span><b>${Math.round(share * 100)}%</b></div>`)
    .join('')}</div>`;

function participantLine(topic) {
  const names = participants[TOPICS.findIndex((t) => t.name === topic.name)].map((a) => ACCOUNTS[a].name);
  return `<div class="tt-participants">Today: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` +${names.length - 6}` : ''}</div>`;
}

// The floating card for whatever is under the pointer.
const tooltipFor = (item) => (item.kind === 'topic' ? topicCard(item) + participantLine(item) : accountCard(item));

// --- Labels -------------------------------------------------------------------------------------------

const minorTopic = new Set([...TOPICS].sort((a, b) => b.engagement - a.engagement).slice(Math.ceil(TOPICS.length / 2)).map((t) => t.name));

const itemLabels = ITEMS.map((item, i) => {
  const el = document.createElement('div');
  // The smaller half of the mountains get smaller plates, so more fit and the big ones stand out.
  el.className = item.kind === 'topic' ? `acct-label topic-label${minorTopic.has(item.name) ? ' minor' : ''}` : 'acct-label';
  el.innerHTML = `<span>${item.name}</span>`;
  // Topic plates are interactive: hovering one selects its topic (over whatever hill is behind it),
  // clicking opens its card.
  const plate = el.firstChild;
  plate.addEventListener('pointerenter', () => (pinned < 0 || isConnected(i)) && (plateHover = i));
  plate.addEventListener('pointerleave', () => plateHover === i && (plateHover = -1));
  plate.addEventListener('click', () => (pinned < 0 || isConnected(i) ? pin(i) : unpin()));
  const obj = new CSS2DObject(el);
  scene.add(obj);
  return obj;
});

// --- Building the map -----------------------------------------------------------------------------

function build() {
  if (active) {
    scene.remove(active.group);
    disposeTree(active.group);
  }
  active = createInk({
    accounts: ACCOUNTS,
    topics: TOPICS,
    participation: { interests, participants },
    regions: REGIONS,
    moods: MOODS,
    focus: moodFocus,
    showQuiet: townsShown === 'all',
  });
  scene.add(active.group);
  controls.maxPolarAngle = active.maxPolarAngle;
  scene.background = new THREE.Color(active.background);
  renderer.toneMapping = active.toneMapping;
  active.setHeights(current);
  active.setGroupFilter(selectedGroups.size ? new Set(selectedGroups) : null);
  lastFocus = -1; // re-apply the pinned item's trails on the new map
  document.getElementById('footnote').textContent = `${DATA_NOTE} · towns are accounts, mountains are topics · click for details`;
  renderLegend();
  syncButtons();
}

let switching = false;
const fade = document.getElementById('fade');
function rebuildWithFade() {
  if (switching) return;
  switching = true;
  fade.classList.add('on');
  setTimeout(() => {
    build();
    fade.classList.remove('on');
    switching = false;
  }, 350);
}

function setMoodFocus(f) {
  if (f === moodFocus || switching) return;
  moodFocus = f;
  rebuildWithFade();
}


// --- Controls and legend --------------------------------------------------------------------------

const legendEl = document.getElementById('legend');

// Hatch strokes going from thin, faint, sparse and broken (sceptics) to bold and dense (believers).
const weightKey = `<svg class="key-weight" viewBox="0 0 96 12" preserveAspectRatio="none" aria-hidden="true">${(() => {
  const out = [];
  for (let x = 2, f = 0; x < 92; f = x / 92) {
    out.push(`<line x1="${x}" y1="${f < 0.3 ? 3 : 1}" x2="${x + 4}" y2="11" stroke="#141414" stroke-width="${(0.4 + f * 1.9).toFixed(2)}" opacity="${(0.25 + f * 0.75).toFixed(2)}" vector-effect="non-scaling-stroke"/>`);
    x += 11 - f * 7.5;
  }
  return out.join('');
})()}</svg>`;

// The mood key: washes for outlook, line weight for belief, a split wash for division; cues for axes
// hidden by the focus are dimmed.
function moodKey() {
  const on = (axis) => (moodFocus === 'all' || moodFocus === axis ? '' : ' off');
  return `<div class="mood-key">
    <div class="key-row${on('outlook')}"><span>Worried</span><span class="key-bar key-wash"></span><span>Hopeful</span></div>
    <div class="key-row${on('belief')}"><span>Sceptics</span>${weightKey}<span>Believers</span></div>
    <div class="key-row wide${on('division')}"><span class="key-split"></span><span>Split wash = divided topic</span></div>
  </div>`;
}

// Whether an item belongs to the selected groups: an account by its group, a topic if a selected group
// makes up at least 15% of its authors.
function inSelection(item) {
  if (!selectedGroups.size) return true;
  if (item.groups) return item.groups.some(([g, share]) => share >= 0.15 && selectedGroups.has(g));
  return selectedGroups.has(item.region);
}

function toggleGroup(id) {
  if (selectedGroups.has(id)) selectedGroups.delete(id);
  else selectedGroups.add(id);
  active.setGroupFilter(selectedGroups.size ? new Set(selectedGroups) : null);
  renderLegend();
}

function renderLegend() {
  const rows = REGIONS.map(
    (r) => `<div class="legend-row${selectedGroups.has(r.id) ? ' selected' : selectedGroups.size ? ' dimmed' : ''}" data-group="${r.id}">
      <span class="legend-name">${r.label}</span>
      ${moodShown() ? `<span class="legend-sub">${MOODS[r.id]?.posts === 0 ? 'no posts here' : describeMood(MOODS[r.id])}</span>` : ''}
    </div>`
  ).join('');
  legendEl.innerHTML = rows;
  document.getElementById('mood-key').innerHTML = moodShown() ? moodKey() : '';
}

function syncButtons() {
  document.querySelectorAll('#mood-seg button').forEach((b) => b.classList.toggle('active', b.dataset.focus === moodFocus));
}

legendEl.addEventListener('click', (e) => {
  const id = e.target.closest('.legend-row')?.dataset.group;
  if (id) toggleGroup(id);
});
document.getElementById('mood-seg').addEventListener('click', (e) => {
  const f = e.target.closest('button')?.dataset.focus;
  if (f) setMoodFocus(f);
});

// The source: every platform together, or one (live atlases keep per-platform sums); reloads with ?source=.
if (SOURCES.length) {
  const seg = document.getElementById('source-seg');
  document.getElementById('source-control').hidden = false;
  seg.querySelectorAll('button').forEach((b) => {
    b.hidden = b.dataset.source && !SOURCES.includes(b.dataset.source);
    b.classList.toggle('active', b.dataset.source === (SOURCE ?? ''));
  });
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.source === (SOURCE ?? '')) return;
    const url = new URL(location.href);
    if (b.dataset.source) url.searchParams.set('source', b.dataset.source);
    else url.searchParams.delete('source');
    location.href = url.href;
  });
}

// Top stories or niche ones (specific discussions with a smaller crowd); reloads with ?stories=.
if (NICHE_AVAILABLE) {
  const seg = document.getElementById('stories-seg');
  document.getElementById('stories-control').hidden = false;
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.stories === (NICHE ? 'niche' : '')));
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.stories === (NICHE ? 'niche' : '')) return;
    const url = new URL(location.href);
    if (b.dataset.stories) url.searchParams.set('stories', 'niche');
    else url.searchParams.delete('stories');
    location.href = url.href;
  });
}

// The time window, on the live atlases; each window is its own atlas, so switching reloads with ?data=.
const windowSeg = document.getElementById('window-seg');
if (DATASET.startsWith('live-')) {
  document.getElementById('window-control').hidden = false;
  windowSeg.querySelectorAll('button').forEach((b) => {
    b.hidden = !has(b.dataset.window);
    b.classList.toggle('active', b.dataset.window === DATASET);
  });
  windowSeg.addEventListener('click', (e) => {
    const w = e.target.closest('button')?.dataset.window;
    if (!w || w === DATASET) return;
    const url = new URL(location.href);
    url.searchParams.set('data', w);
    location.href = url.href;
  });
}

// --- Hover, tooltip, click -------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerInside = false;
let pointerClient = { x: 0, y: 0 };
let downAt = null;
const tooltip = document.getElementById('tooltip');

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerClient = { x: e.clientX, y: e.clientY };
  pointerInside = true;
});
// The tooltip follows the pointer over plates too (they sit above the canvas).
window.addEventListener('pointermove', (e) => (pointerClient = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener('pointerleave', () => {
  pointerInside = false;
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const isClick = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5;
  downAt = null;
  if (!isClick) return;
  if (hovered >= 0) pin(hovered); // while a card is open, only its connections can be hovered
  else unpin();
});

// --- Detail panel: the pinned item's card, with links to related items and out to other sites -------

const detail = document.getElementById('detail');
const escapeHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pinLink = (i, text) => `<button class="detail-link" data-pin="${i}">${escapeHtml(text)}</button>`;

// A pinned topic's way out to the conversation itself: its most engaging posts, then the same story on
// other sites.
function topicLinks(t) {
  const name = (handle) => ACCOUNTS.find((a) => a.handle === handle)?.name ?? `@${handle}`;
  const posts = (t.topPosts ?? []).map(
    (p) => `<a class="detail-out" href="${postLink(p.id)}" target="_blank" rel="noopener">${escapeHtml(name(p.author))} ↗</a>` +
      `<span class="detail-count">${shortCount(p.engagement)}</span>`
  );
  const elsewhere = (t.elsewhere ?? []).slice(0, 4).map(
    (it) => `<a class="detail-out" href="${it.discussion ?? it.url}" target="_blank" rel="noopener" title="${escapeHtml(it.title ?? '')}">${escapeHtml(sourceLabel(it))} ↗</a>`
  );
  return (
    (posts.length ? `<div class="detail-section">Top posts</div><div class="detail-posts">${posts.join('')}</div>` : '') +
    (elsewhere.length ? `<div class="detail-section">Also on</div><div class="detail-posts">${elsewhere.join('')}</div>` : '')
  );
}

function detailHtml(i) {
  const item = ITEMS[i];
  let body;
  if (item.kind === 'topic') {
    const people = participants[i - nA];
    body =
      topicCard(item, topicLinks(item)) +
      `<div class="detail-section">${people.length} ${people.length === 1 ? 'account' : 'accounts'} posted about it</div>
       <div class="detail-links">${people.map((a) => pinLink(a, ACCOUNTS[a].name)).join('')}</div>`;
  } else {
    const joined = participants.map((list, t) => (list.includes(i) ? t : -1)).filter((t) => t >= 0);
    body =
      accountCard(item) +
      (item.bio ? `<div class="detail-bio">${escapeHtml(item.bio)}</div>` : '') +
      (joined.length
        ? `<div class="detail-section">Posted about</div>
           <div class="detail-links">${joined.map((t) => pinLink(nA + t, TOPICS[t].name)).join('')}</div>`
        : `<div class="detail-section">No AI posts in this window</div>`);
  }
  // Accounts link out from their platform rows; a topic links to a search for it.
  const out = item.kind === 'topic' ? `<div class="detail-outs"><a class="detail-out" href="${urlFor(item)}" target="_blank" rel="noopener">Search on ${SOURCE === 'bluesky' ? 'Bluesky' : 'X'} ↗</a></div>` : '';
  return `<button class="detail-close" aria-label="Close">×</button>${body}${out}`;
}

// Items connected to the pinned one: a topic's accounts, an account's topics.
function isConnected(i) {
  if (pinned < 0) return false;
  if (pinned >= nA) return i < nA && participants[pinned - nA].includes(i);
  return i >= nA && participants[i - nA].includes(pinned);
}

function pin(i) {
  pinned = i;
  plateHover = -1;
  document.body.classList.add('modal');
  detail.innerHTML = detailHtml(i);
  detail.hidden = false;
  detail.scrollTop = 0;
  tooltip.hidden = true;
}

function unpin() {
  pinned = -1;
  detail.hidden = true;
  document.body.classList.remove('modal');
}

detail.addEventListener('click', (e) => {
  const target = e.target.closest('[data-pin], .detail-close');
  if (!target) return;
  if (target.classList.contains('detail-close')) unpin();
  else pin(Number(target.dataset.pin));
});
window.addEventListener('keydown', (e) => e.key === 'Escape' && unpin());

function updateHover() {
  let next = -1;
  if (switching) next = -1;
  else if (plateHover >= 0) next = plateHover;
  else if (pointerInside) {
    raycaster.setFromCamera(pointer, camera);
    next = active.pick(raycaster);
  }
  if (pinned >= 0 && !isConnected(next)) next = -1;
  if (next !== hovered) {
    hovered = next;
    renderer.domElement.style.cursor = hovered >= 0 ? 'pointer' : '';
    // The pinned item's card is already in the panel; anything else gets the floating tooltip.
    if (hovered >= 0 && hovered !== pinned) tooltip.innerHTML = tooltipFor(ITEMS[hovered]);
    tooltip.hidden = hovered < 0 || hovered === pinned;
  }
  const focus = focusOf();
  if (focus !== lastFocus) {
    lastFocus = focus;
    active.setHovered(focus);
  }
  if (!tooltip.hidden) {
    const x = Math.min(pointerClient.x + 16, window.innerWidth - tooltip.offsetWidth - 8);
    const y = Math.min(pointerClient.y + 16, window.innerHeight - tooltip.offsetHeight - 8);
    tooltip.style.transform = `translate(${x}px, ${y}px)`;
  }
}

// --- Loop ------------------------------------------------------------------

const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
const screen = new THREE.Vector3();

// On-screen box of a label (half width, half height, and how far its centre sits above the anchor), for
// skipping labels that would overlap. Uses the label's measured size once it has been shown; until then
// an estimate (topic labels are plates of up to two lines of spaced capitals, town names one line).
function labelBox(item, label) {
  if (label.userData.box) return label.userData.box;
  if (item.kind === 'topic') {
    const charW = minorTopic.has(item.name) ? 7.2 : 8.6;
    const maxLine = 17; // characters that fit the plate's max width
    const lines = Math.min(2, Math.ceil(item.name.length / maxLine));
    const w = Math.ceil(item.name.length / lines) * charW + 16;
    const h = lines * 15 + 9;
    return { halfW: w / 2, halfH: h / 2, lift: h * 0.5 + 6 };
  }
  return { halfW: item.name.length * 3.6 + 6, halfH: 9, lift: 0 };
}

// Show the focused item and its connections, then topic plates, then the biggest towns, skipping any
// label that would collide on screen with one already placed.
const labelShift = []; // each label's vertical nudge (px) to clear the plates placed before it

function placeLabels() {
  const order = labelOrder(current, camera.position.distanceTo(controls.target));
  const focus = focusOf();
  order.unshift(...active.emphasis());
  if (focus >= 0) order.unshift(focus);
  // Hovering a topic shows only its plate over its trails. A pinned item shows only itself and its
  // connections (a topic's accounts, an account's topics).
  if (hovered >= 0 && ITEMS[hovered].kind === 'topic') order.length = 1;
  else if (pinned >= 0) order.length = 1 + active.emphasis().length;
  const placed = [];
  const shown = new Set();
  for (const i of order) {
    if (shown.has(i) || !active.isShown(i)) continue;
    if (i !== focus && !inSelection(ITEMS[i])) continue;
    screen.copy(active.group.localToWorld(active.anchor(i, tmp))).project(camera);
    const x = ((screen.x + 1) / 2) * window.innerWidth;
    const y = ((1 - screen.y) / 2) * window.innerHeight;
    const { halfW, halfH, lift } = labelBox(ITEMS[i], itemLabels[i]);
    const clashes = (cy) => placed.some((r) => Math.abs(r.x - x) < r.halfW + halfW && Math.abs(r.cy - cy) < r.halfH + halfH);
    // A mountain's plate that would overlap one already placed moves up or down by one plate's height
    // before giving up (it shows on hover or closer in); towns' names just give way.
    const step = halfH * 2 + 4;
    const shifts = ITEMS[i].kind === 'topic' ? [0, -step, step] : [0];
    // The hovered or pinned label keeps the place it had: with the others gone it would otherwise snap
    // back from under the pointer, lose the hover and flicker.
    let shift = i === focus && labelShift[i] != null ? labelShift[i] : shifts.find((d) => !clashes(y - lift + d));
    if (shift == null) {
      if (i !== focus) continue;
      shift = 0;
    }
    labelShift[i] = shift;
    placed.push({ x, cy: y - lift + shift, halfW, halfH });
    shown.add(i);
  }
  itemLabels.forEach((label, i) => {
    label.position.copy(active.group.localToWorld(active.anchor(i, tmp)));
    label.visible = shown.has(i);
    label.element.style.marginTop = labelShift[i] ? `${labelShift[i]}px` : '';
    label.element.classList.toggle('hovered', i === focus);
    label.element.classList.toggle('connected', isConnected(i));
    // Measure each label once it's on screen, so later frames use its real size.
    if (label.visible && !label.userData.box) {
      const span = label.element.firstChild;
      if (span.offsetWidth) {
        label.userData.box = {
          halfW: span.offsetWidth / 2 + 2,
          halfH: span.offsetHeight / 2 + 2,
          lift: ITEMS[i].kind === 'topic' ? span.offsetHeight / 2 + 6 : 0,
        };
      }
    }
  });
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  // Ease heights toward the target when the metric changes.
  const k = 1 - Math.exp(-dt * 5);
  let moving = false;
  for (let i = 0; i < current.length; i++) {
    const d = target[i] - current[i];
    if (Math.abs(d) > 0.01) {
      current[i] += d * k;
      moving = true;
    } else {
      current[i] = target[i];
    }
  }
  if (moving) active.setHeights(current);
  controls.update();
  active.group.updateMatrixWorld();

  placeLabels();
  updateHover();
  composer.render();
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  labelRenderer.setSize(w, h);
});

build();
camera.position.set(...active.cameraHome);
// ?pin=<name> in the URL opens with that item selected (for sharing a topic or an account).
const pinIndex = ITEMS.findIndex((x) => x.name === params.get('pin'));
if (pinIndex >= 0) pin(pinIndex);
frame();
