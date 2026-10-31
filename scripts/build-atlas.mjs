// Package Round 0 into the data the site reads: src/data/atlas.json.
//
//   npm run build-atlas
//   DATASET=<handle> npm run build-atlas      # another dataset → src/data/atlas-<handle>.json
//
// Accounts: every seed with a profile (merged child accounts like @claudeai are left off; their parent
// stands for them) plus every candidate not excluded. Topics: the analysed topics minus catch-alls.
// Also: who discussed each topic (participants), each account's top interests, and group moods.
// Contains no tweet text, only counts, names, bios and our own summaries.

import fs from 'node:fs';
import { readCsv, loadProfiles, loadGroups, loadAccounts, loadBlueskyAccounts, DATASET, ROUND0_ACCOUNTS, RAW, ATLAS } from './lib/data.mjs';

const ANALYSIS = `${RAW}/analysis`;
const NOT_TOPICS = new Set(['Other AI', 'Events, Courses And Hiring']);
const INTERESTS_PER_ACCOUNT = 3;

const profiles = loadProfiles();
// GitHub / Hugging Face matches (scripts/explore-links.mjs): confirmed links, plus organisations matched by
// name on a well-followed account.
const links = new Map(
  (fs.existsSync('data/links.json') ? JSON.parse(fs.readFileSync('data/links.json', 'utf8')) : []).map((r) => [
    r.handle.toLowerCase(),
    r,
  ])
);
const trusted = (m) => m && (m.verdict === 'confirmed' || m.verdict === 'probable');
// Academic records (scripts/explore-papers.mjs): confirmed via Hugging Face claimed papers, or approved
// in data/papers-review.csv.
const papers = fs.existsSync('data/papers.json') ? JSON.parse(fs.readFileSync('data/papers.json', 'utf8')) : {};
// Bluesky accounts matched to ours (scripts/match-bluesky.mjs).
const bluesky = fs.existsSync('data/bluesky.json') ? JSON.parse(fs.readFileSync('data/bluesky.json', 'utf8')) : {};
const groupOf = loadGroups();
const ANALYSIS_DIR = ANALYSIS;
// Each account's AI posts per topic in the data window (all topics, before catch-alls are dropped).
const rawInterestsAll = JSON.parse(fs.readFileSync(`${ANALYSIS_DIR}/interests.json`, 'utf8'));
const accountMoods = fs.existsSync(`${ANALYSIS_DIR}/account-moods.json`)
  ? JSON.parse(fs.readFileSync(`${ANALYSIS_DIR}/account-moods.json`, 'utf8'))
  : {};
const read = (f) => JSON.parse(fs.readFileSync(`${ANALYSIS}/${f}`, 'utf8'));

// --- Accounts ---------------------------------------------------------------------------------

const entries =
  ROUND0_ACCOUNTS
    ? [
        ...readCsv('data/seeds.csv')
          .filter((s) => !s.parent)
          .map((s) => ({ handle: s.handle, type: s.type, source: 'seed' })),
        ...readCsv('data/candidates.csv')
          .filter((c) => c.group && c.group !== 'exclude')
          .map((c) => ({ handle: c.handle, type: c.type, source: c.source })),
        // On Bluesky only: no X profile, so their own profile stands in.
        ...loadBlueskyAccounts()
          .filter((b) => b.group !== 'exclude')
          .map((b) => ({
            handle: b.handle,
            type: b.type,
            source: 'bluesky',
            profile: { username: b.handle, name: b.name, description: b.bio ?? '' },
            bluesky: { handle: b.handle, followers: b.followers, posts: b.posts },
          })),
      ]
    : loadAccounts()
        .filter((a) => a.group !== 'exclude')
        .map((a) => ({ handle: a.handle, type: a.type, source: 'following' }));
function sources(handle) {
  const l = links.get(handle.toLowerCase());
  const out = {};
  if (trusted(l?.github)) {
    const g = l.github;
    out.github = { login: g.login, stars: g.stars ?? 0, followers: g.followers ?? 0, repos: g.repos ?? 0 };
  }
  if (trusted(l?.huggingface)) {
    const h = l.huggingface;
    out.huggingface = {
      username: h.username,
      org: !!h.org,
      followers: h.followers ?? 0,
      models: h.models ?? 0,
      datasets: h.datasets ?? 0,
      spaces: h.spaces ?? 0,
    };
  }
  const pa = papers[handle];
  if (pa) out.papers = { openalex: pa.id, works: pa.works, citations: pa.citations, hIndex: pa.hIndex };
  const b = bluesky[handle];
  if (b) out.bluesky = { handle: b.bluesky, followers: b.followers, posts: b.posts };
  return out;
}

const accounts = [];
const seen = new Set();
for (const e of entries) {
  const p = profiles.get(e.handle.toLowerCase()) ?? e.profile;
  const region = groupOf.get(e.handle.toLowerCase());
  if (!p || !region || region === 'exclude' || seen.has(p.username.toLowerCase())) continue;
  seen.add(p.username.toLowerCase());
  accounts.push({
    handle: p.username,
    name: p.name,
    type: e.type || 'person',
    region,
    // X numbers; null for an account on Bluesky only.
    followers: p.public_metrics?.followers_count ?? null,
    tweets: p.public_metrics?.tweet_count ?? null,
    bio: p.description.replace(/\s+/g, ' ').slice(0, 160),
    source: e.source,
    ...sources(e.handle),
    ...(e.bluesky && { bluesky: e.bluesky }),
    ...(accountMoods[p.username] ? { mood: accountMoods[p.username] } : {}),
    aiPosts: Object.values(rawInterestsAll[p.username] ?? {}).reduce((n, k) => n + k, 0),
  });
}
const indexOf = new Map(accounts.map((a, i) => [a.handle.toLowerCase(), i]));

// --- Topics -------------------------------------------------------------------------------------

const topics = read('topics.json')
  .filter((t) => !NOT_TOPICS.has(t.name))
  .map((t) => ({
    name: t.name,
    summary: t.summary,
    region: t.groups[0][0],
    groups: t.groups,
    tweets: t.posts,
    authors: t.authors,
    engagement: t.engagement,
    query: t.name,
    section: t.section,
    platforms: t.platforms,
    ...(t.specificity != null && { specificity: t.specificity }),
    ...(t.nicheOnly && { nicheOnly: true }),
    topPosts: t.topPosts,
    mood: {
      outlook: t.mood.outlook,
      belief: t.mood.belief,
      division: t.mood.division,
      camps: t.mood.camps,
      sides: t.mood.camps?.map(([o]) => o),
      scored: t.mood.scored,
    },
    participants: t.authorList.map((h) => indexOf.get(h.toLowerCase())).filter((i) => i != null),
    // Per platform (live datasets): the same numbers from X or Bluesky posts alone.
    ...(t.byPlatform && {
      byPlatform: Object.fromEntries(
        Object.entries(t.byPlatform).map(([pl, b]) => [
          pl,
          {
            tweets: b.posts,
            authors: b.authors,
            engagement: b.engagement,
            groups: b.groups,
            mood: { ...b.mood, sides: b.mood.camps?.map(([o]) => o) },
            participants: b.authorList.map((h) => indexOf.get(h.toLowerCase())).filter((i) => i != null),
            topPosts: b.topPosts,
          },
        ])
      ),
    }),
  }));
const topicIndex = new Map(topics.map((t, k) => [t.name, k]));

// The niche view: specific discussions (specificity from live-topics.mjs) that still carry weight in the
// window, ranked by how specific they are, how much engagement they drew, and, the other way round from the
// main ranking, by having a smaller crowd.
const NICHE_SPECIFICITY = 0.5;
const NICHE_MIN_ENGAGEMENT = 0.15; // engagement percentile among the window's topics
const percentileOf = (values) => (v) => values.filter((x) => x <= v).length / values.length;
const engagementP = percentileOf(topics.map((t) => t.engagement));
const authorsP = percentileOf(topics.map((t) => t.authors));
for (const t of topics) {
  if ((t.specificity ?? 0) < NICHE_SPECIFICITY || engagementP(t.engagement) < NICHE_MIN_ENGAGEMENT) continue;
  t.niche = +(t.specificity * (0.5 + 0.5 * engagementP(t.engagement)) * (0.6 + 0.4 * (1 - authorsP(t.authors)))).toFixed(3);
}

// --- Interests ----------------------------------------------------------------------------------

const rawInterests = read('interests.json');
const interests = accounts.map((a) => {
  const counts = Object.entries(rawInterests[a.handle] ?? {}).filter(([name]) => topicIndex.has(name));
  const max = Math.max(1, ...counts.map(([, n]) => n));
  return counts
    .sort((x, y) => y[1] - x[1])
    .slice(0, INTERESTS_PER_ACCOUNT)
    .map(([name, n]) => [topicIndex.get(name), +(n / max).toFixed(2)]);
});

// Other sources merged into the topics (scripts/merge-sources.mjs): links per topic, new stories X didn't
// surface, and prediction markets.
// Round 0's come from data/raw/sources/merged.json; a live window's from its own sources.json
// (scripts/live-build.mjs); following-list datasets go without.
const mergedFile = DATASET === 'round0' ? 'data/raw/sources/merged.json' : `${RAW}/sources.json`;
const merged = fs.existsSync(mergedFile)
  ? JSON.parse(fs.readFileSync(mergedFile, 'utf8'))
  : { items: [], stories: {}, markets: [] };
const link = ({ source, kind, title, url, discussion, score, comments }) => ({ source, kind, title, url, discussion, score, comments });
const byScore = (a, b) => (b.score ?? 0) - (a.score ?? 0);
for (const t of topics) t.elsewhere = merged.items.filter((it) => it.topic === t.name).sort(byScore).map(link);
// One ranking for X topics and stories from elsewhere, so the front page can lead with either: each
// counts by its best standing within a source (a topic's reach among X topics; an item's score among its
// source's items, as Bluesky likes run far higher than Hacker News points; blogs and news have no score
// and count as middling), plus a little for being on more sources (up to 0.15) and having more items (0.05).
const standing = new Map();
for (const src of new Set(merged.items.map((it) => it.source))) {
  const scores = merged.items.filter((it) => it.source === src && it.score != null).map((it) => it.score);
  standing.set(src, (score) => (score == null || !scores.length ? 0.5 : scores.filter((x) => x <= score).length / scores.length));
}
const reach = (t) => t.authors * Math.log10(1 + t.engagement);
const reaches = topics.map(reach);
const rankOf = (best, items, onX) => {
  const sources = new Set(items.map((it) => it.source)).size + (onX ? 1 : 0);
  return +(best + Math.min(0.15, 0.05 * (sources - 1)) + Math.min(0.05, 0.01 * (items.length - 1))).toFixed(3);
};
for (const t of topics) {
  const x = reaches.filter((r) => r <= reach(t)).length / reaches.length;
  t.rank = rankOf(Math.max(x, ...t.elsewhere.map((it) => standing.get(it.source)(it.score))), t.elsewhere, true);
}
const stories = Object.entries(merged.stories)
  .map(([name, list]) => ({ name, rank: rankOf(Math.max(...list.map((it) => standing.get(it.source)(it.score))), list, false), items: list.sort(byScore).map(link) }))
  .sort((a, b) => b.rank - a.rank);
const markets = merged.markets
  .map(({ question, url, probability, traders, topics: on }) => ({ question, url, probability, traders, topics: on }))
  .sort((a, b) => (b.traders ?? 0) - (a.traders ?? 0));

// AI stock quotes (scripts/fetch-sources.mjs), each tied to the topics its pattern matches.
const stocksFile = fs.existsSync(`${RAW}/stocks.json`) ? `${RAW}/stocks.json` : 'data/raw/sources/stocks.json';
const stocks = fs.existsSync(stocksFile)
  ? JSON.parse(fs.readFileSync(stocksFile, 'utf8')).map(({ about, ...q }) => ({
      ...q,
      topics: topics.filter((t) => new RegExp(`\\b(${about})`, 'i').test(t.name)).map((t) => t.name),
    }))
  : [];

const atlas = {
  window: JSON.parse(fs.readFileSync(`${RAW}/state.json`, 'utf8')),
  accounts,
  topics: topics.map(({ participants, ...t }) => t),
  participants: topics.map((t) => t.participants),
  interests,
  groupMoods: read('group-moods.json'),
  ...(fs.existsSync(`${ANALYSIS}/group-moods-by-platform.json`) && { groupMoodsByPlatform: read('group-moods-by-platform.json') }),
  stories,
  markets,
  stocks,
  briefing: fs.existsSync(`${ANALYSIS}/briefing.json`) ? read('briefing.json') : null,
};
atlas.window = { from: atlas.window.startTime, to: atlas.window.endTime };
fs.writeFileSync(ATLAS, JSON.stringify(atlas));

const byRegion = {};
for (const a of accounts) byRegion[a.region] = (byRegion[a.region] ?? 0) + 1;
console.log(`${accounts.length} accounts`, byRegion);
console.log(
  `On GitHub: ${accounts.filter((a) => a.github).length}, on Hugging Face: ${accounts.filter((a) => a.huggingface).length}, ` +
    `with papers: ${accounts.filter((a) => a.papers).length}`
);
console.log(`${topics.length} topics; ${interests.filter((i) => i.length).length} accounts with interests`);
console.log(`Elsewhere: ${topics.reduce((n, t) => n + t.elsewhere.length, 0)} links on topics, ${stories.length} new stories, ${markets.length} markets, ${stocks.length} stocks`);
console.log(`Wrote ${ATLAS}`);
