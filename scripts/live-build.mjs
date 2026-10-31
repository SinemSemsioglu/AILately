// Live pipeline, step 4: sum the stored, scored posts over three rolling windows (the last day, 3 days and
// week) and build the site's data for each: src/data/atlas-live-day.json, -3d and -week (view them with
// ?data=live-day etc.). The day also gets the one-line briefing. Topics need posts from at least three
// accounts in the window, except specific ones for the niche view (see kept).
//
//   npm run live-build

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { aggregate, phraseKey } from './lib/analysis.mjs';
import { LIVE, loadPosts, loadReads, loadTopics } from './lib/live.mjs';
import { loadGroups } from './lib/data.mjs';

const DAY = 24 * 3600e3;
const WINDOWS = { day: DAY, '3d': 3 * DAY, week: 7 * DAY };
const MIN_AUTHORS = 3;
// Specific discussions often have a small crowd: for the niche view they count with two accounts, or one
// post that drew real attention; they're marked nicheOnly so the main view leaves them out.
const NICHE_SPECIFICITY = 0.5;
const NICHE_SOLO_ENGAGEMENT = 1000;
const kept = (t) =>
  t.authors >= MIN_AUTHORS || ((t.specificity ?? 0) >= NICHE_SPECIFICITY && (t.authors >= 2 || t.engagement >= NICHE_SOLO_ENGAGEMENT));

const reads = loadReads();
const registry = loadTopics();
const groupOf = loadGroups();
const topicOf = new Map(Object.entries(registry.phrases));
const topicMeta = new Map(Object.entries(registry.topics).filter(([, t]) => t.name !== 'Other AI'));
const now = Date.now();
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 1));
const readLive = (name, fallback) => (fs.existsSync(path.join(LIVE, name)) ? JSON.parse(fs.readFileSync(path.join(LIVE, name), 'utf8')) : fallback);

// The other sources (scripts/live-sources.mjs), in the shape build-atlas reads: items tied to a topic by
// name, stories found only elsewhere, and markets with the topics they bear on.
const sourceItems = Object.values(readLive('items.json', {}));
const sourceMarkets = Object.values(readLive('markets.json', {})).filter((m) => m.relevant && m.probability != null);
const stocks = readLive('stocks.json', null);
const nameOf = (key) => registry.topics[key]?.name;
function sourcesFor(from, to) {
  const inWindow = sourceItems.filter((it) => it.time >= from && it.time <= to);
  const stories = {};
  for (const it of inWindow) if (it.story) (stories[it.story] ??= []).push(it);
  return {
    items: inWindow.map(({ merged, topic, ...it }) => ({ ...it, topic: nameOf(topic) ?? null })),
    stories,
    markets: sourceMarkets.map((m) => ({ ...m, topics: m.topics.map(nameOf).filter(Boolean) })),
  };
}

for (const [name, span] of Object.entries(WINDOWS)) {
  const from = now - span;
  const posts = loadPosts(from, now)
    .map((p) => ({ ...p, group: groupOf.get(p.author.toLowerCase()) ?? 'exclude' }))
    .filter((p) => p.group !== 'exclude' && reads.get(p.id)?.ai && topicOf.has(phraseKey(reads.get(p.id).topic)));
  // Skip a longer window until the store covers more than the shorter one would.
  const oldest = Math.min(...posts.map((p) => Date.parse(p.created_at)));
  if (name !== 'day' && oldest > now - span / 2) {
    console.log(`${name}: not enough history yet, skipped`);
    continue;
  }
  const result = aggregate({ posts, read: reads, topicOf, topicMeta });
  // The same sums per platform, for the map's source selector.
  const groupMoodsBy = {};
  for (const platform of ['x', 'bluesky']) {
    const sub = aggregate({ posts: posts.filter((p) => (p.platform ?? 'x') === platform), read: reads, topicOf, topicMeta });
    if (!sub.topics.length) continue;
    groupMoodsBy[platform] = sub.groupMoods;
    for (const t of sub.topics) {
      const whole = result.topics.find((x) => x.key === t.key);
      whole.byPlatform ??= {};
      whole.byPlatform[platform] = {
        posts: t.posts,
        authors: t.authors,
        engagement: t.engagement,
        groups: t.groups,
        mood: t.mood,
        authorList: t.authorList,
        topPosts: t.topPosts,
      };
    }
  }
  const dataset = `live-${name}`;
  const dir = path.join('data/raw', dataset, 'analysis');
  fs.mkdirSync(dir, { recursive: true });
  writeJson(
    path.join(dir, 'topics.json'),
    result.topics.filter(kept).map(({ key, ...t }) => ({ ...t, ...(t.authors < MIN_AUTHORS && { nicheOnly: true }) }))
  );
  writeJson(path.join(dir, 'interests.json'), result.interests);
  writeJson(path.join(dir, 'account-moods.json'), result.accountMoods);
  writeJson(path.join(dir, 'group-moods.json'), result.groupMoods);
  writeJson(path.join(dir, 'group-moods-by-platform.json'), groupMoodsBy);
  writeJson(path.join('data/raw', dataset, 'state.json'), { startTime: new Date(from).toISOString(), endTime: new Date(now).toISOString() });
  writeJson(path.join('data/raw', dataset, 'sources.json'), sourcesFor(from, now));
  if (stocks) writeJson(path.join('data/raw', dataset, 'stocks.json'), stocks);

  const env = { ...process.env, DATASET: dataset };
  execFileSync('node', ['scripts/build-atlas.mjs'], { env, stdio: 'ignore' });
  if (name === 'day') {
    execFileSync('node', ['scripts/write-briefing.mjs'], { env, stdio: 'ignore' });
    execFileSync('node', ['scripts/build-atlas.mjs'], { env, stdio: 'ignore' });
  }
  console.log(`${name}: ${posts.length} AI posts, ${result.topics.filter((t) => t.authors >= MIN_AUTHORS).length} topics (+${result.topics.filter((t) => kept(t) && t.authors < MIN_AUTHORS).length} niche only) → src/data/atlas-${dataset}.json`);
}
