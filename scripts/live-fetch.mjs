// Live pipeline, step 1: fetch our accounts' new original posts since the last run: from X (through
// twitterapi.io), refreshing the engagement of posts that are now ~6 and ~24 hours old (a post fetched
// minutes after it went up has barely any likes yet); and from Bluesky, for accounts matched there
// (data/bluesky.json), whose feeds also give fresh engagement for everything they return.
//
//   npm run live-fetch                # then live-score, live-topics, live-build (npm run live does all)
//
// The first run fetches the last 24 hours. Needs TWITTERAPI_IO_KEY in .env.

import fs from 'node:fs';
import { client, originalPostQueries, normalizeTweet } from './lib/twitterapi.mjs';
import { savePosts, loadState, saveState } from './lib/live.mjs';
import { authorPosts } from './lib/bluesky.mjs';
import { loadBlueskyAccounts } from './lib/data.mjs';

const BUDGET = 10; // dollars, across all runs; raise it as the months go by
const HOUR = 3600e3;
const REFRESH_AGES = [6 * HOUR, 24 * HOUR];
const MAX_GAP = 3 * 24 * HOUR; // after a long pause, start from 3 days back, not from the last run

const state = loadState();
const accounts = JSON.parse(fs.readFileSync('src/data/atlas.json', 'utf8')).accounts;
const handles = accounts.filter((a) => a.followers != null).map((a) => a.handle); // on X
const api = client({ budget: BUDGET, spent: state.spent });

const now = Date.now();
const last = state.x?.lastFetch;
const since = Math.max(last ?? now - 24 * HOUR, now - MAX_GAP);
const windows = [['new', since, now]];
if (last) for (const age of REFRESH_AGES) windows.push([`refresh ${age / HOUR}h`, since - age, now - age]);

for (const [label, from, to] of windows) {
  const posts = [];
  for (const q of originalPostQueries(handles, from, to)) {
    for (const t of await api.search(q)) {
      const p = normalizeTweet(t);
      if (p) posts.push(p);
    }
  }
  savePosts(posts);
  console.log(`X ${label}: ${posts.length} posts (${new Date(from).toISOString().slice(5, 16)} → ${new Date(to).toISOString().slice(5, 16)})`);
}

state.x = { ...state.x, lastFetch: now, first: state.x?.first ?? since };

// Bluesky: each matched account's posts back to a day before the last fetch (so recent posts get their
// engagement refreshed too). Free, no account needed.
// Matched accounts post under their X handle; accounts on Bluesky only under their Bluesky handle.
const matched = fs.existsSync('data/bluesky.json') ? JSON.parse(fs.readFileSync('data/bluesky.json', 'utf8')) : {};
const onBluesky = [
  ...Object.entries(matched).filter(([handle]) => handles.includes(handle)).map(([handle, m]) => [handle, m.did]),
  ...loadBlueskyAccounts().filter((b) => b.group !== 'exclude').map((b) => [b.handle, b.did]),
];
const bskySince = (state.bluesky?.lastFetch ?? now) - 24 * HOUR;
let bskyPosts = 0;
for (const [handle, did] of onBluesky) {
  const posts = await authorPosts(did, handle, bskySince);
  savePosts(posts);
  bskyPosts += posts.length;
}
state.bluesky = { lastFetch: now };
console.log(`Bluesky: ${bskyPosts} posts from ${onBluesky.length} accounts`);
state.spent = api.spent;
saveState(state);
console.log(`Spent so far: $${state.spent.toFixed(3)}`);
