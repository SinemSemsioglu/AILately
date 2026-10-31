// Fetch a dataset from one person's X following list, through twitterapi.io (a third-party X data API,
// ~30× cheaper than X's own): the accounts they follow, and those accounts' original posts (no replies or
// reposts) over the same window as Round 0, so the two maps compare. About $0.50 for 1,000 follows.
//
//   npm run fetch-following -- <handle> --dry-run    # print the plan, no requests
//   npm run fetch-following -- <handle>              # then classify-following, analyze, build-atlas
//
// Needs TWITTERAPI_IO_KEY in .env. Writes data/raw/<handle>/: following-*.json and posts-*.json as they
// arrive, then profiles-0.json (in the shape lib/data.mjs reads) and posts.jsonl (the shape analyze.mjs
// reads). Progress and spending are saved in state.json after each request; re-running resumes.

import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.twitterapi.io/twitter';
const CREDIT = 0.00001; // dollars (100,000 credits = $1)
const BUDGET = 3; // dollars, across all runs
const MAX_QUERY = 480; // characters per search query
const MAX_PAGES = 50; // per search batch (20 posts a page)

const handle = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!handle || handle.startsWith('-')) {
  console.error('Usage: npm run fetch-following -- <handle> [--dry-run]');
  process.exit(1);
}
const key = process.env.TWITTERAPI_IO_KEY;
if (!key && !dryRun) {
  console.error('TWITTERAPI_IO_KEY is not set (add it to .env).');
  process.exit(1);
}

const DIR = `data/raw/${handle.toLowerCase()}`;
const STATE = path.join(DIR, 'state.json');
fs.mkdirSync(DIR, { recursive: true });

function writeJson(file, data) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1));
  fs.renameSync(`${file}.tmp`, file);
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// The window: Round 0's, so the maps compare.
const round0 = readJson('data/raw/round0/state.json');
const state = fs.existsSync(STATE)
  ? readJson(STATE)
  : { handle, startTime: round0.startTime, endTime: round0.endTime, spent: 0, followingPages: 0, cursor: '', followingDone: false, batchesDone: [] };
const save = () => writeJson(STATE, state);

async function get(endpoint, params, credits) {
  if (state.spent + credits * CREDIT > BUDGET) throw new Error(`budget of $${BUDGET} reached; raise BUDGET to go on`);
  const url = `${API}/${endpoint}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 401 || res.status === 402 || res.status === 403) throw Object.assign(new Error(`HTTP ${res.status}: ${await res.text()}`), { fatal: true });
      if (res.status === 429) throw new Error('rate limited');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.status === 'error') throw Object.assign(new Error(body.msg || body.message), { fatal: true });
      return body;
    } catch (e) {
      if (e.fatal || attempt >= 6) throw e;
      console.warn(`  ${e.message}; retrying (${attempt})`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

// --- 1. The following list, 200 accounts a page -----------------------------------------------------

if (dryRun) {
  console.log(`Plan for @${handle}: following list (~$0.002 a page of 200), then original posts from`);
  console.log(`${state.startTime} to ${state.endTime} (~$0.15 per 1,000 posts). Budget $${BUDGET}; spent so far $${state.spent.toFixed(3)}.`);
  process.exit(0);
}

while (!state.followingDone) {
  const page = await get('user/followings', { userName: handle, cursor: state.cursor, pageSize: 200 }, 200);
  writeJson(path.join(DIR, `following-${state.followingPages}.json`), page.followings);
  state.spent += Math.max(60, page.followings.length) * CREDIT;
  state.followingPages++;
  state.cursor = page.next_cursor;
  state.followingDone = !page.has_next_page || !page.followings.length;
  save();
  console.log(`following: page ${state.followingPages}, ${page.followings.length} accounts`);
}

const users = new Map();
for (let k = 0; k < state.followingPages; k++) {
  for (const u of readJson(path.join(DIR, `following-${k}.json`))) users.set(u.screen_name.toLowerCase(), u);
}
const open = [...users.values()].filter((u) => !u.protected);
console.log(`${users.size} follows (${users.size - open.length} protected, skipped)`);

// Profiles in the X API v2 shape lib/data.mjs reads.
writeJson(path.join(DIR, 'profiles-0.json'), {
  data: open.map((u) => ({
    id: u.id,
    username: u.screen_name,
    name: u.name,
    description: u.description ?? '',
    public_metrics: { followers_count: u.followers_count ?? 0, tweet_count: u.statuses_count ?? 0, following_count: u.friends_count ?? u.following_count ?? 0 },
  })),
});

// --- 2. Their original posts in the window, through batched from: searches ----------------------------

const since = Math.floor(Date.parse(state.startTime) / 1000);
const until = Math.floor(Date.parse(state.endTime) / 1000);
const suffix = ` -filter:replies -filter:retweets since_time:${since} until_time:${until}`;
const batches = [];
let current = [];
for (const u of open) {
  const next = [...current, u.screen_name];
  if (current.length && `(${next.map((h) => `from:${h}`).join(' OR ')})${suffix}`.length > MAX_QUERY) {
    batches.push(current);
    current = [u.screen_name];
  } else current = next;
}
if (current.length) batches.push(current);

for (let b = 0; b < batches.length; b++) {
  if (state.batchesDone.includes(b)) continue;
  const query = `(${batches[b].map((h) => `from:${h}`).join(' OR ')})${suffix}`;
  const tweets = [];
  let cursor = '';
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await get('tweet/advanced_search', { query, queryType: 'Latest', cursor }, 20 * 15);
    tweets.push(...(page.tweets ?? []));
    state.spent += Math.max(15, (page.tweets?.length ?? 0) * 15) * CREDIT;
    if (!page.has_next_page || !page.tweets?.length) break;
    cursor = page.next_cursor;
  }
  writeJson(path.join(DIR, `posts-${b}.json`), tweets);
  state.batchesDone.push(b);
  save();
  console.log(`posts: batch ${b + 1}/${batches.length}, ${tweets.length} posts ($${state.spent.toFixed(3)} so far)`);
}

// --- 3. posts.jsonl, in the shape analyze.mjs reads -----------------------------------------------------

const seen = new Set();
const lines = [];
for (let b = 0; b < batches.length; b++) {
  for (const t of readJson(path.join(DIR, `posts-${b}.json`))) {
    if (seen.has(t.id) || t.isReply || t.retweeted_tweet) continue;
    seen.add(t.id);
    lines.push({
      id: t.id,
      author: t.author.userName,
      created_at: new Date(t.createdAt).toISOString(),
      text: t.text,
      metrics: {
        like_count: t.likeCount ?? 0,
        retweet_count: t.retweetCount ?? 0,
        reply_count: t.replyCount ?? 0,
        quote_count: t.quoteCount ?? 0,
        impression_count: t.viewCount ?? 0,
        bookmark_count: t.bookmarkCount ?? 0,
      },
      links: (t.entities?.urls ?? []).map((u) => u.expanded_url).filter(Boolean),
      mentions: (t.entities?.user_mentions ?? []).map((m) => m.screen_name),
      quotes: t.quoted_tweet ? [t.quoted_tweet.id] : [],
    });
  }
}
lines.sort((a, b) => a.created_at.localeCompare(b.created_at));
fs.writeFileSync(path.join(DIR, 'posts.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
console.log(`\n${lines.length} posts from ${new Set(lines.map((l) => l.author)).size} accounts → ${DIR}/posts.jsonl`);
console.log(`Spent about $${state.spent.toFixed(3)}`);
