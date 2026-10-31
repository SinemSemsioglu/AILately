// Round 0, the cheap version (~$20): profiles for every seed and candidate, plus the last few days of
// their *original* posts (no replies or retweets), fetched with batched `from:` searches.
//
//   npm run round0 -- --dry-run     # print the plan and worst-case cost, no requests
//   npm run round0                  # run it; safe to stop and re-run at any point
//
// Built for an unstable connection: every response is written to disk as it arrives, and progress
// (including money spent) is saved after each request in data/raw/round0/state.json. Re-running picks
// up exactly where it stopped, never re-fetches what it already has, and the spending cap counts
// everything spent across all runs. Network errors are retried with backoff; auth, credit and
// rate-limit errors stop the run cleanly (just re-run later).

import fs from 'node:fs';
import path from 'node:path';

const RATE_POST = 0.005;
const RATE_USER = 0.01;
const BUDGET = 20; // dollars, across all runs
const DAYS = 3; // how far back to read posts
const MAX_QUERY = 480; // characters per search query, kept under X's limit
const DIR = 'data/raw/round0';
const STATE = path.join(DIR, 'state.json');

const dryRun = process.argv.includes('--dry-run');

// --- Files: written atomically so an interruption never leaves half a file ------------------

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (quoted) {
      if (ch === '"' && text[k + 1] === '"') (field += '"'), k++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(field), (field = '');
    else if (ch === '\n') row.push(field.replace(/\r$/, '')), rows.push(row), (row = []), (field = '');
    else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows.filter((r) => r.some(Boolean));
  return body.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
}

// --- State ----------------------------------------------------------------------------------

fs.mkdirSync(DIR, { recursive: true });
const seeds = readCsv('data/seeds.csv').map((r) => r.handle);
const candidates = readCsv('data/candidates.csv').map((r) => r.handle);
// Seeds first: if the budget runs out, it's the candidates' posts that go missing.
const handles = [...new Set([...seeds, ...candidates])];

const state = fs.existsSync(STATE)
  ? JSON.parse(fs.readFileSync(STATE, 'utf8'))
  : {
      // The time window is fixed on the first run, so re-runs read the same days.
      startTime: new Date(Date.now() - DAYS * 864e5).toISOString().replace(/\.\d+Z$/, 'Z'),
      endTime: new Date(Date.now() - 60e3).toISOString().replace(/\.\d+Z$/, 'Z'),
      spent: { users: 0, posts: 0, requests: 0 },
      profileChunks: {}, // chunk index → 'done'
      batches: null, // built after profiles: [{ handles, next, pages, done }]
    };
const save = () => writeJson(STATE, state);
const cost = () => state.spent.users * RATE_USER + state.spent.posts * RATE_POST;

// --- Plan -----------------------------------------------------------------------------------

const PROFILE_CHUNK = 100;
const chunks = [];
for (let k = 0; k < handles.length; k += PROFILE_CHUNK) chunks.push(handles.slice(k, k + PROFILE_CHUNK));

function batchQueries(list) {
  const out = [];
  let cur = [];
  const query = (hs) => `(${hs.map((h) => `from:${h}`).join(' OR ')}) -is:retweet -is:reply`;
  for (const h of list) {
    if (cur.length && query([...cur, h]).length > MAX_QUERY) out.push(cur), (cur = []);
    cur.push(h);
  }
  if (cur.length) out.push(cur);
  return out.map((hs) => ({ handles: hs, query: query(hs), next: null, pages: 0, done: false }));
}

if (dryRun) {
  const batches = state.batches ?? batchQueries(handles);
  console.log(`Accounts: ${handles.length} (${seeds.length} seeds + ${handles.length - seeds.length} candidates)`);
  console.log(`Window: ${state.startTime} → ${state.endTime} (${DAYS} days), originals only`);
  console.log(`Requests: ${chunks.length} profile lookups, ${batches.length} search batches (+ pages as needed)`);
  console.log(`Profiles: ≤ ${handles.length} users ≈ $${(handles.length * RATE_USER).toFixed(2)}`);
  console.log(`Posts: as many as the remaining budget allows, ≈ ${Math.floor((BUDGET - handles.length * RATE_USER) / RATE_POST)} max`);
  console.log(`Hard cap: $${BUDGET} across all runs (spent so far: $${cost().toFixed(2)})`);
  process.exit(0);
}

const token = process.env.X_BEARER_TOKEN;
if (!token) {
  console.error('X_BEARER_TOKEN is not set (add it to .env).');
  process.exit(1);
}

// --- API ------------------------------------------------------------------------------------

class Stop extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.x.com/2/${url}`, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      if (attempt >= 6) throw new Stop(`network keeps failing (${e.cause?.code ?? e.message}); re-run when it's back`);
      const wait = Math.min(60, 2 ** attempt) * 1000;
      console.warn(`  network error (${e.cause?.code ?? e.message}), retrying in ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    state.spent.requests++;
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    if (res.status === 429) throw new Stop('rate limited by X; re-run in ~15 minutes');
    if ([401, 402, 403].includes(res.status)) throw new Stop(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    if (res.status >= 500 && attempt < 4) {
      await sleep(3000 * attempt);
      continue;
    }
    throw new Stop(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
}

const USER_FIELDS = 'user.fields=description,public_metrics,created_at,verified,url,location,protected';
const TWEET_FIELDS =
  'tweet.fields=author_id,created_at,public_metrics,entities,referenced_tweets,conversation_id,lang,note_tweet';

// --- Run ------------------------------------------------------------------------------------

try {
  // 1. Profiles, 100 per request.
  for (const [k, chunk] of chunks.entries()) {
    if (state.profileChunks[k] === 'done') continue;
    if (cost() + chunk.length * RATE_USER > BUDGET) throw new Stop('budget reached during profiles');
    const body = await get(`users/by?usernames=${chunk.join(',')}&${USER_FIELDS}`);
    writeJson(path.join(DIR, `profiles-${k}.json`), body);
    state.spent.users += body.data?.length ?? 0;
    state.profileChunks[k] = 'done';
    save();
    console.log(`profiles ${k + 1}/${chunks.length}: ${body.data?.length ?? 0} found, ${body.errors?.length ?? 0} missing`);
  }

  // 2. Original posts from every account that exists and isn't protected, in batched searches.
  if (!state.batches) {
    const found = chunks.flatMap((_, k) => JSON.parse(fs.readFileSync(path.join(DIR, `profiles-${k}.json`))).data ?? []);
    const open = new Set(found.filter((u) => !u.protected).map((u) => u.username.toLowerCase()));
    state.batches = batchQueries(handles.filter((h) => open.has(h.toLowerCase())));
    save();
  }
  for (const [b, batch] of state.batches.entries()) {
    while (!batch.done) {
      if (cost() + 100 * RATE_POST > BUDGET) throw new Stop('budget reached; the remaining batches are left for later');
      const url =
        `tweets/search/recent?query=${encodeURIComponent(batch.query)}&start_time=${state.startTime}` +
        `&end_time=${state.endTime}&max_results=100&${TWEET_FIELDS}` +
        (batch.next ? `&next_token=${batch.next}` : '');
      const body = await get(url);
      writeJson(path.join(DIR, `posts-${b}-${batch.pages}.json`), body);
      state.spent.posts += body.data?.length ?? 0;
      batch.pages++;
      batch.next = body.meta?.next_token ?? null;
      batch.done = !batch.next;
      save();
    }
    console.log(`posts batch ${b + 1}/${state.batches.length} done · spent $${cost().toFixed(2)}`);
  }
  console.log('\nRound 0 complete.');
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  save();
  console.log(`\nStopped: ${e.message}`);
  console.log('Progress is saved. Run the same command again to continue.');
}

const doneBatches = state.batches?.filter((b) => b.done).length ?? 0;
console.log(
  `Spent so far: $${cost().toFixed(2)} (${state.spent.users} profiles, ${state.spent.posts} posts, ${state.spent.requests} requests)` +
    (state.batches ? ` · post batches ${doneBatches}/${state.batches.length}` : '')
);
