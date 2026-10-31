// The daily front page, "Briefing" layout: a written lede, a few headline stories, and everything else in
// a compact index you open on request. Terms are defined inline; the Field guide explains the rest.
import { ACCOUNTS, REGIONS, DATA_WINDOW } from './data/accounts.js';
import { TOPICS, STORIES, MARKETS } from './data/topics.js';
import { MOODS } from './data/moods.js';
import { participants } from './data/participation.js';
import atlas, { NICHE, NICHE_AVAILABLE } from './data/atlas.js';
import { GROUPS, term, moodWords, installDefinitions } from './glossary.js';
import { postLink, shortCount, sourceLabel } from './posts.js';

const SECTIONS = [
  ['models', 'Models & launches'],
  ['research', 'Research'],
  ['tools', 'Tools & building'],
  ['safety', 'Safety & policy'],
  ['industry', 'Industry & money'],
  ['society', 'Society & debate'],
];
const HEADLINES = 4; // the lead plus three
const INDEX_ROWS = 8; // rows of "All stories" shown before "Show all"
const FORECASTS = 3;
const STOCKS = 6; // stock quotes in the top bar
const SHORT_GROUP = { frontier: 'Frontier', research: 'Research', builders: 'Builders', creative: 'Creative', discourse: 'Commentary', safety: 'Safety' };

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const day = (iso, opts) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', ...opts });
const mapLink = (name) => `./index.html?pin=${encodeURIComponent(name)}`;
const accountByHandle = new Map(ACCOUNTS.map((a) => [a.handle, a]));
const sectionName = (key) => SECTIONS.find(([k]) => k === key)?.[1] ?? '';

// Topics in front-page order: biggest reach first (the same ranking the map uses for mountains).
const ranked = [...TOPICS].sort((a, b) => b.authors * Math.log10(1 + b.engagement) - a.authors * Math.log10(1 + a.engagement));
// Headlines: the biggest stories from any source, on one ranking (scripts/build-atlas.mjs).
const headlines = [...TOPICS, ...STORIES].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, HEADLINES);
const isTopic = (x) => TOPICS.includes(x);
const headlineTopics = headlines.filter(isTopic);

// --- Pieces -------------------------------------------------------------------------------------

// A labelled bar: a marker on a track from `low` to `high` (value -1…1, or 0…1 when `from0`).
function scale(low, high, value, from0 = false) {
  const left = from0 ? 0 : Math.min(50, 50 + value * 50);
  const width = from0 ? value * 100 : Math.abs(value) * 50;
  return `<div class="scale"><span>${low}</span><span class="bar${from0 ? '' : ' centred'}"><i style="left:${left}%;width:${width}%"></i></span><span>${high}</span></div>`;
}

const moodScales = (m) =>
  m.scored === 0
    ? `<p class="no-stance-note">No post took a stance on this yet: mostly news and links, so there's no mood to show.</p>`
    : `<div class="scales">
  ${scale(term('worried', 'Worried'), term('hopeful', 'Hopeful'), m.outlook)}
  ${scale(term('sceptics', 'Sceptics'), term('believers', 'Believers'), m.belief)}
  ${scale('Agreed', term('divided', 'Divided'), m.division, true)}
</div>`;

const stats = (t) => `<span class="stats">${t.authors} accounts · ${t.tweets} posts</span>`;

// Where a story was discussed: X (for topics), then each other source once.
const sourceNames = (items, onX) => [...(onX ? ['X'] : []), ...new Set(items.map((it) => (it.kind === 'company' ? `${it.source} blog` : it.source)))];
const sources = (t) => `<span class="sources">${sourceNames(t.elsewhere ?? [], true).join(' · ')}</span>`;
// The index's short version: the first three, then a count.
function shortSources(names) {
  const short = names.map((n) => (n === 'Hacker News' ? 'HN' : n));
  return short.length > 3 ? `${short.slice(0, 3).join(' · ')} +${short.length - 3}` : short.join(' · ');
}



// The story's most engaging posts (with likes + reposts + replies + quotes), right under its summary: linked by author, so readers can go and read them.
const topPosts = (t) =>
  t.topPosts?.length
    ? `<div class="top-posts"><span class="label">Top posts</span>${t.topPosts
        .map(
          (p) => `<span class="post"><a href="${postLink(p.id)}" target="_blank" rel="noopener">${esc(accountByHandle.get(p.author)?.name ?? `@${p.author}`)} ↗</a>` +
            ` <span class="stats">${shortCount(p.engagement)}</span></span>`
        )
        .join('')}</div>`
    : '';

// A story's details, shown when it's expanded: groups, people, other sources, a forecast.
function details(t) {
  const people = participants[TOPICS.indexOf(t)].slice(0, 8).map((i) => esc(ACCOUNTS[i].name));
  const market = MARKETS.find((m) => m.topics.includes(t.name));
  const elsewhere = (t.elsewhere ?? []).slice(0, 4);
  return `<div class="details">
    ${moodScales(t.mood)}
    <div class="row"><span class="label">Groups</span><span>${t.groups
      .filter(([, s]) => s >= 0.1)
      .map(([g, s]) => `${term(g)} ${Math.round(s * 100)}%`)
      .join(' · ')}</span></div>
    ${people.length ? `<div class="row"><span class="label">With</span><span>${people.join(', ')}${t.authors > 8 ? ` and ${t.authors - 8} more` : ''}</span></div>` : ''}
    ${
      elsewhere.length
        ? `<div class="row"><span class="label">Also on</span><span>${elsewhere
            .map((it) => `<a href="${it.discussion ?? it.url}" target="_blank" rel="noopener" title="${esc(it.title)}">${esc(sourceLabel(it))} ↗</a>`)
            .join(' · ')}</span></div>`
        : ''
    }
    ${
      market
        ? `<div class="row"><span class="label">Forecast</span><span><b>${Math.round(market.probability * 100)}%</b> <a href="${market.url}" target="_blank" rel="noopener">${esc(market.question)}</a></span></div>`
        : ''
    }
    <a class="to-map" href="${mapLink(t.name)}">See it on the map →</a>
  </div>`;
}

// A headline story: kicker, headline, summary, top posts, mood in words; details behind "More" (open on the
// lead, which has the room).
function headline(t, lead) {
  return `<article class="story${lead ? ' lead' : ''}">
    <div class="kicker">${esc(sectionName(t.section))}</div>
    <h${lead ? 2 : 3}><a href="${mapLink(t.name)}">${esc(t.name)}</a></h${lead ? 2 : 3}>
    <p class="summary">${esc(t.summary)}</p>
    ${topPosts(t)}
    <div class="meta"><span class="mood">${moodWords(t.mood)}</span>${stats(t)}${sources(t)}</div>
    <details${lead ? ' open' : ''}><summary>${lead ? 'Details' : 'More'}</summary>${details(t)}</details>
  </article>`;
}

// A headline for a story X didn't surface: what it is, and its links with their sources.
function elsewhereHeadline(st, lead) {
  const name = st.name[0].toUpperCase() + st.name.slice(1);
  const titled = st.items.find((it) => it.source !== 'Bluesky');
  const bluesky = st.items.filter((it) => it.source === 'Bluesky');
  const summary = titled?.title ?? `${bluesky.length} ${bluesky.length === 1 ? 'post' : 'posts'} on Bluesky`;
  const linkLabel = (it) => (it.kind === 'company' ? `${it.source} blog` : it.source === 'Hacker News' ? 'Article' : it.source);
  const count = (it) => (it.source === 'Bluesky' ? `${shortCount(it.score)} likes` : it.kind === 'papers' ? `${it.score} upvotes` : '');
  const H = lead ? 'h2' : 'h3';
  return `<article class="story${lead ? ' lead' : ''}">
    <div class="kicker">Elsewhere</div>
    <${H}><a href="${st.items[0].discussion ?? st.items[0].url}" target="_blank" rel="noopener">${esc(name)}</a></${H}>
    <p class="summary">${esc(summary)}</p>
    <div class="top-posts"><span class="label">Read</span>${st.items
      .slice(0, 3)
      .map(
        (it) => `<span class="post"><a href="${it.url}" target="_blank" rel="noopener">${esc(linkLabel(it))} ↗</a>${count(it) ? ` <span class="stats">${count(it)}</span>` : ''}</span>` +
          (it.discussion ? `<span class="post"><a href="${it.discussion}" target="_blank" rel="noopener">Discussion ↗</a> <span class="stats">${it.score} pts</span></span>` : '')
      )
      .join('')}</div>
    <div class="meta"><span class="sources">${[...new Set(st.items.map((it) => it.source))].join(' · ')} · not on X</span></div>
  </article>`;
}

// One line of the index: headline · mood · accounts; opens to the summary and details.
function indexRow(t) {
  return `<details class="index-row" data-section="${t.section}">
    <summary><span class="i-name">${esc(t.name)}</span><span class="mood">${moodWords(t.mood)}</span>` +
    `<span class="i-sources" title="${esc(sourceNames(t.elsewhere ?? [], true).join(', '))}">${esc(shortSources(sourceNames(t.elsewhere ?? [], true)))}</span><span class="i-count">${t.authors}</span></summary>
    <div class="i-body"><p class="summary">${esc(t.summary)}</p>${topPosts(t)}${details(t)}</div>
  </details>`;
}

// A story X didn't surface (Hacker News, blogs, news): its links.
function elsewhereRow(s) {
  return `<details class="index-row" data-section="elsewhere">
    <summary><span class="i-name">${esc(s.items[0].title)}</span><span class="mood">–</span>` +
    `<span class="i-sources" title="${esc(s.items.map(sourceLabel).join(', '))}">${esc(shortSources(sourceNames(s.items, false)))}</span><span class="i-count"></span></summary>
    <div class="i-body">${s.items
      .map((it) => `<div><a href="${it.discussion ?? it.url}" target="_blank" rel="noopener">${esc(it.title)} ↗</a> <span class="stats">${esc(sourceLabel(it))}</span></div>`)
      .join('')}</div>
  </details>`;
}

// The briefing's {{Topic}} and [[term]] marks become links and definitions.
function briefingHtml(text) {
  return esc(text)
    .replace(/\{\{(.+?)\}\}/g, (_, name) => (TOPICS.some((t) => t.name === name) ? `<a href="#" data-topic="${esc(name)}">${name}</a>` : name))
    .replace(/\[\[(.+?)\]\]/g, (_, key) => (GROUPS[key] ? term(key) : term(key, key)));
}

// --- Top bar: the day's mood, its extremes, forecasts and stocks, in a row above the stories ---------

// Each group's outlook as a marker on one worried-to-hopeful wash (the map's colours). Labels alternate
// above and below the line and are spread apart by layoutAxis(), with a leader line to their marker.
// Click a group to see its stories.
function moodAxis() {
  const groups = REGIONS.filter((r) => MOODS[r.id]).sort((a, b) => MOODS[a.id].outlook - MOODS[b.id].outlook);
  const x = (r) => 50 + MOODS[r.id].outlook * 50;
  const title = (r) => `${esc(r.label)}: ${esc(moodWords(MOODS[r.id]).replace(/<[^>]+>/g, ''))}`;
  return `<section class="cell cell-mood">
    <h4>Mood of the day</h4>
    <div class="mood-axis">
      <div class="axis-track"></div>
      <svg class="axis-leaders" aria-hidden="true"></svg>
      ${groups
        .map(
          (r, k) => `<i class="axis-dot" data-group="${r.id}" style="left:${x(r)}%" title="${title(r)}"></i>` +
            `<button class="axis-group ${k % 2 ? 'below' : 'above'}" data-group="${r.id}" data-x="${x(r)}" title="${title(r)}">${SHORT_GROUP[r.id] ?? esc(r.label)}</button>`
        )
        .join('')}
    </div>
    <div class="axis-ends"><span>${term('worried', 'Worried')}</span><span>Each group's ${term('outlook', 'outlook')} · click one for its stories</span><span>${term('hopeful', 'Hopeful')}</span></div>
  </section>`;
}

// Spread each row of labels so none overlap (centred on their marker where there's room), then draw
// leader lines from label to marker.
function layoutAxis() {
  const axis = document.querySelector('.mood-axis');
  const W = axis.clientWidth;
  const GAP = 10;
  const TRACK = 38; // the track's centre line
  let lines = '';
  for (const row of ['above', 'below']) {
    const labels = [...axis.querySelectorAll(`.axis-group.${row}`)]
      .map((el) => ({ el, x: (Number(el.dataset.x) / 100) * W, w: el.offsetWidth }))
      .sort((a, b) => a.x - b.x);
    const pos = labels.map((l) => l.x - l.w / 2);
    for (let k = 0; k < pos.length; k++) pos[k] = Math.max(pos[k], k ? pos[k - 1] + labels[k - 1].w + GAP : 0);
    let limit = W;
    for (let k = pos.length - 1; k >= 0; k--) {
      pos[k] = Math.min(pos[k], limit - labels[k].w);
      limit = pos[k] - GAP;
    }
    labels.forEach((l, k) => {
      l.el.style.left = `${Math.max(0, pos[k])}px`;
      const y = row === 'above' ? l.el.offsetTop + l.el.offsetHeight : l.el.offsetTop;
      lines += `<line x1="${pos[k] + l.w / 2}" y1="${y}" x2="${l.x}" y2="${TRACK + (row === 'above' ? -7 : 7)}" />`;
    });
  }
  axis.querySelector('.axis-leaders').innerHTML = lines;
}

function extremes() {
  const scored = TOPICS.filter((t) => (t.mood.scored ?? 0) >= 3);
  const pick = (cmp) => [...(scored.length ? scored : TOPICS)].sort(cmp)[0];
  const rows = [
    ['Most hopeful', pick((a, b) => b.mood.outlook - a.mood.outlook)],
    ['Most worried', pick((a, b) => a.mood.outlook - b.mood.outlook)],
    ['Most divided', pick((a, b) => b.mood.division - a.mood.division)],
  ];
  return `<section class="cell extremes">
    <h4>Extremes</h4>
    ${rows.map(([label, t]) => `<div><span>${label}</span><a href="#" data-topic="${esc(t.name)}">${esc(t.name)}</a></div>`).join('')}
  </section>`;
}

function forecasts() {
  // Markets tied to today's headline stories first, then the busiest.
  const top = headlineTopics.map((t) => t.name);
  const tied = (m) => Number(m.topics.some((n) => top.includes(n)));
  const list = [...MARKETS].sort((a, b) => tied(b) - tied(a));
  if (!list.length) return '';
  return `<section class="cell">
    <h4>Forecasts <span class="cell-note">Manifold</span></h4>
    ${list
      .slice(0, FORECASTS)
      .map((m) => `<div class="forecast"><b>${Math.round(m.probability * 100)}%</b> <a href="${m.url}" target="_blank" rel="noopener">${esc(m.question)}</a></div>`)
      .join('')}
  </section>`;
}

function stocks() {
  // Stocks tied to today's headline stories first, then by size of the move.
  const top = headlineTopics.map((t) => t.name);
  const tied = (q) => Number(q.topics.some((n) => top.includes(n)));
  const list = [...(atlas.stocks ?? [])].sort((a, b) => tied(b) - tied(a) || Math.abs(b.change) - Math.abs(a.change));
  if (!list.length) return '';
  const asOf = new Date(Math.max(...list.map((q) => q.time))).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `<section class="cell">
    <h4>AI stocks <span class="cell-note">${asOf}</span></h4>
    <div class="stocks">${list
      .slice(0, STOCKS)
      .map(
        (q) => `<div class="stock" title="${esc(q.name)}${q.topics.length ? `: ${esc(q.topics.join(', '))}` : ''}"><b>${q.symbol}</b>` +
          `<i class="${q.change < 0 ? 'down' : 'up'}">${q.change < 0 ? '▼' : '▲'} ${Math.abs(q.change).toFixed(1)}%</i></div>`
      )
      .join('')}</div>
  </section>`;
}

// The Top / Niche switch: links that reload the page with or without ?stories=niche.
function viewLink(value, label) {
  const url = new URL(location.href);
  if (value) url.searchParams.set('stories', value);
  else url.searchParams.delete('stories');
  const here = (value === 'niche') === NICHE;
  return `<a href="${url.search || '?'}"${here ? ' class="here"' : ''}>${label}</a>`;
}

// --- Page -----------------------------------------------------------------------------------------

const [lead, ...rest] = headlines;
const others = ranked.filter((t) => !headlines.includes(t));
const story = (x, isLead) => (isTopic(x) ? headline(x, isLead) : elsewhereHeadline(x, isLead));
const dates = `${day(DATA_WINDOW.from)}–${day(DATA_WINDOW.to, { month: 'long', year: 'numeric' })}`;
const briefing = atlas.briefing;

document.getElementById('page').innerHTML = `
  <header class="masthead">
    <nav><a href="./index.html">Map</a><a class="here" href="./dashboard.html">Today</a><a href="./field-guide.html">Field guide</a></nav>
    <h1>The Day in AI</h1>
    <div class="dateline">
      <span>${dates} · ${TOPICS.length + STORIES.length} ${NICHE ? 'niche stories: specific discussions a smaller crowd is having' : 'stories from X, Bluesky, Hacker News, papers, blogs and news'}</span>
      ${NICHE_AVAILABLE ? `<span class="view-switch">${viewLink('', 'Top stories')}${viewLink('niche', 'Niche')}</span>` : ''}
    </div>
    <div class="how-to-read">How to read this: stories come from <a href="./field-guide.html#groups">six groups</a> of the AI world;
      their mood is ${term('outlook', 'outlook')}, ${term('belief', 'belief')} and ${term('division', 'division')}.
      Underlined words explain themselves on hover. <a href="./field-guide.html">Field guide →</a></div>
  </header>

  ${
    briefing
      ? `<section class="briefing"><p>${briefingHtml(briefing.lede)}</p></section>`
      : ''
  }

  <div class="pulse">${moodAxis()}${extremes()}${forecasts()}${stocks()}</div>

  <div class="front">
    <div class="top">
      ${story(lead, true)}
      <div class="secondary">${rest.map((x) => story(x, false)).join('')}</div>
    </div>
  </div>

  <section class="all-stories" id="all-stories">
    <div class="all-head">
      <h4>All stories</h4>
      <div class="chips">
        <button class="chip on" data-filter="all">All</button>
        ${SECTIONS.map(([k, label]) => `<button class="chip" data-filter="${k}">${label}</button>`).join('')}
        <button class="chip" data-filter="elsewhere">Elsewhere</button>
      </div>
    </div>
    <div class="group-filter" hidden></div>
    <div class="index-head"><span>Story</span><span>Mood</span><span>Sources</span><span>Accounts</span></div>
    <div class="index">${others.map(indexRow).join('')}${STORIES.filter((st) => !headlines.includes(st)).slice(0, 15).map(elsewhereRow).join('')}</div>
    <button class="show-all" hidden>Show all</button>
  </section>

  <footer>Topics, summaries, moods and the briefing are written by Claude from public posts and links in the window.
  Sizes and moods are rough signals, not measurements. <a href="./field-guide.html">How this works →</a></footer>
`;

// --- Behaviour: filters, show all, jumping to a story -----------------------------------------------

const rows = [...document.querySelectorAll('.index-row')];
const showAll = document.querySelector('.show-all');
const groupFilter = document.querySelector('.group-filter');
let filter = 'all';
let group = null; // a group picked in "Mood of the day"
let expanded = false;

const topicOf = (row) => TOPICS.find((t) => t.name === row.querySelector('.i-name').textContent);

function applyFilter() {
  const matching = rows.filter((row) => {
    if (filter !== 'all' && row.dataset.section !== filter) return false;
    if (!group) return true;
    return topicOf(row)?.groups.some(([g, share]) => g === group && share >= 0.15);
  });
  rows.forEach((row) => (row.hidden = true));
  matching.forEach((row, k) => (row.hidden = !expanded && k >= INDEX_ROWS));
  showAll.hidden = expanded || matching.length <= INDEX_ROWS;
  showAll.textContent = `Show all ${matching.length}`;
  groupFilter.hidden = !group;
  if (group) groupFilter.innerHTML = `Stories with ${term(group)} <button class="clear">× clear</button>`;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.filter === filter));
  document.querySelectorAll('.mood-axis [data-group]').forEach((b) => b.classList.toggle('on', b.dataset.group === group));
}

document.querySelector('.chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  filter = chip.dataset.filter;
  applyFilter();
});
showAll.addEventListener('click', () => {
  expanded = true;
  applyFilter();
});
groupFilter.addEventListener('click', (e) => {
  if (!e.target.closest('.clear')) return;
  group = null;
  applyFilter();
});
layoutAxis();
addEventListener('resize', layoutAxis);
document.fonts?.ready.then(layoutAxis);
document.querySelector('.mood-axis').addEventListener('click', (e) => {
  const b = e.target.closest('[data-group]');
  if (!b) return;
  group = group === b.dataset.group ? null : b.dataset.group;
  filter = 'all';
  expanded = true;
  applyFilter();
  document.getElementById('all-stories').scrollIntoView({ behavior: 'smooth' });
});

// Links to a topic (in the briefing and the top bar) open its story: a headline's details, or its index row.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-topic]');
  if (!a) return;
  e.preventDefault();
  const name = a.dataset.topic;
  const headlineEl = [...document.querySelectorAll('.story')].find((s) => s.querySelector('h2, h3')?.textContent === name);
  const target = headlineEl?.querySelector('details') ?? rows.find((r) => r.querySelector('.i-name').textContent === name);
  if (!target) return;
  if (target.classList.contains('index-row')) {
    filter = 'all';
    group = null;
    expanded = true;
    applyFilter();
  }
  target.open = true;
  (headlineEl ?? target).scrollIntoView({ behavior: 'smooth', block: 'center' });
});

applyFilter();
installDefinitions();
