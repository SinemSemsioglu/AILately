// A small, hard-capped test run against the X API, to get real numbers (cost, posting volume,
// reply share, who the seeds talk to, what topic search turns up) before the full pipeline.
//
//   npm run pilot -- --dry-run      # print the plan and worst-case cost, no requests
//   npm run pilot                   # run it (reads X_BEARER_TOKEN from .env)
//
// Options: --region safety  --accounts 15  --tweets 10  --search 25  --query "interpretability" (repeatable)
// Raw responses and a report are saved under data/raw/pilot-<timestamp>/ (gitignored).

import fs from 'node:fs';
import path from 'node:path';

// Pay-per-use rates as quoted earlier; check the developer console for the real ones.
const RATE_POST = 0.005;
const RATE_USER = 0.01;
// Hard caps: a request that could push reads past these is skipped, never sent.
const MAX_POSTS = 300;
const MAX_USERS = 80;

const DEFAULT_QUERIES = {
  safety: ['interpretability', '"AI safety"'],
  research: ['"reinforcement learning" LLM', 'arxiv LLM'],
  builders: ['"coding agent"', '"MCP server"'],
  frontier: ['"new model"', '"system card"'],
  discourse: ['AGI', '"AI bubble"'],
  creative: ['"AI video"', '"image model"'],
  robotics: ['humanoid', '"robot learning"'],
};

// --- Args ---------------------------------------------------------------------

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const k = argv.indexOf(`--${name}`);
  return k >= 0 ? argv[k + 1] : fallback;
};
const region = opt('region', 'safety');
const nAccounts = Number(opt('accounts', 15));
const nTweets = Math.max(5, Math.min(100, Number(opt('tweets', 10))));
const nSearch = Math.max(10, Math.min(100, Number(opt('search', 25))));
const queries = argv.flatMap((a, k) => (a === '--query' ? [argv[k + 1]] : []));
if (!queries.length) queries.push(...(DEFAULT_QUERIES[region] ?? ['AI']));
const dryRun = argv.includes('--dry-run');

// --- Seeds --------------------------------------------------------------------

const rows = fs
  .readFileSync('data/seeds.csv', 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.split(','));
const header = rows.shift();
const seeds = rows.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
const rank = { high: 0, medium: 1, low: 2 };
const picked = seeds
  .filter((s) => s.region === region && !s.parent)
  .sort((a, b) => rank[a.confidence] - rank[b.confidence])
  .slice(0, nAccounts);
const seedHandles = new Set(seeds.map((s) => s.handle.toLowerCase()));

const worst = {
  users: picked.length + queries.length * nSearch,
  posts: picked.length * nTweets + queries.length * nSearch,
};
console.log(`Pilot: ${picked.length} "${region}" seeds × ${nTweets} tweets, ${queries.length} searches × ${nSearch}`);
console.log(`Queries: ${queries.join(' | ')}`);
console.log(
  `Worst case: ${worst.posts} posts + ${worst.users} users ≈ $${(worst.posts * RATE_POST + worst.users * RATE_USER).toFixed(2)}` +
    ` (caps: ${MAX_POSTS} posts, ${MAX_USERS} users)`
);
if (dryRun) {
  console.log(`Seeds: ${picked.map((s) => s.handle).join(', ')}`);
  process.exit(0);
}

const token = process.env.X_BEARER_TOKEN;
if (!token) {
  console.error('X_BEARER_TOKEN is not set. Put it in .env and run with: node --env-file=.env scripts/pilot.mjs');
  process.exit(1);
}

// --- API ----------------------------------------------------------------------

const outDir = path.join('data/raw', `pilot-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(outDir, { recursive: true });
const used = { requests: 0, posts: 0, users: 0 };

// GET with the budget check: `maxPosts`/`maxUsers` are the most this request could return.
async function get(name, url, { maxPosts = 0, maxUsers = 0 } = {}) {
  if (used.posts + maxPosts > MAX_POSTS || used.users + maxUsers > MAX_USERS) {
    console.warn(`  skipped ${name}: would exceed the cap`);
    return null;
  }
  const res = await fetch(`https://api.x.com/2/${url}`, { headers: { Authorization: `Bearer ${token}` } });
  used.requests++;
  const body = await res.json().catch(() => ({}));
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(body, null, 2));
  if (!res.ok) {
    console.error(`  ${name}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
    if ([401, 402, 403, 429].includes(res.status)) throw new Error(`Stopping on HTTP ${res.status}`);
    return null;
  }
  used.posts += body.data && url.includes('tweets') ? [].concat(body.data).length : 0;
  used.users += (url.startsWith('users/by') ? [].concat(body.data ?? []).length : 0) + (body.includes?.users?.length ?? 0);
  return body;
}

const TWEET_FIELDS =
  'tweet.fields=created_at,public_metrics,entities,context_annotations,referenced_tweets,in_reply_to_user_id,lang';
const USER_FIELDS = 'user.fields=public_metrics,description,created_at';

// --- Run ----------------------------------------------------------------------

const report = { region, queries, seeds: [], notFound: [], search: [] };
try {
  // 1. Profiles
  const lookup = await get('users', `users/by?usernames=${picked.map((s) => s.handle).join(',')}&${USER_FIELDS}`, {
    maxUsers: picked.length,
  });
  const users = lookup?.data ?? [];
  report.notFound = (lookup?.errors ?? []).map((e) => e.value ?? e.detail);

  // 2. Recent tweets per seed (retweets excluded; replies kept to measure them)
  const mentionedBy = new Map(); // username → set of seeds mentioning them
  const annotations = new Map();
  for (const u of users) {
    const body = await get(`tweets-${u.username}`, `users/${u.id}/tweets?max_results=${nTweets}&exclude=retweets&${TWEET_FIELDS}`, {
      maxPosts: nTweets,
    });
    const tweets = body?.data ?? [];
    const times = tweets.map((t) => Date.parse(t.created_at));
    const spanDays = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 864e5 : null;
    for (const t of tweets) {
      for (const m of t.entities?.mentions ?? []) {
        const name = m.username.toLowerCase();
        if (name === u.username.toLowerCase()) continue;
        if (!mentionedBy.has(name)) mentionedBy.set(name, new Set());
        mentionedBy.get(name).add(u.username);
      }
      for (const a of t.context_annotations ?? []) {
        annotations.set(a.entity.name, (annotations.get(a.entity.name) ?? 0) + 1);
      }
    }
    report.seeds.push({
      handle: u.username,
      followers: u.public_metrics.followers_count,
      lifetimeTweets: u.public_metrics.tweet_count,
      fetched: tweets.length,
      spanDays: spanDays && +spanDays.toFixed(1),
      perDay: spanDays ? +(tweets.length / Math.max(spanDays, 0.1)).toFixed(1) : null,
      replies: tweets.filter((t) => t.in_reply_to_user_id).length,
      quotes: tweets.filter((t) => t.referenced_tweets?.some((r) => r.type === 'quoted')).length,
      withAnnotations: tweets.filter((t) => t.context_annotations?.length).length,
    });
  }
  report.mentionCandidates = [...mentionedBy]
    .filter(([name, by]) => by.size >= 2 && !seedHandles.has(name))
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 25)
    .map(([name, by]) => ({ handle: name, seeds: [...by] }));
  report.topAnnotations = [...annotations].sort((a, b) => b[1] - a[1]).slice(0, 15);

  // 3. Topic searches (relevancy-ranked, originals only)
  for (const [k, q] of queries.entries()) {
    const query = encodeURIComponent(`${q} -is:retweet -is:reply lang:en`);
    const body = await get(
      `search-${k}`,
      `tweets/search/recent?query=${query}&max_results=${nSearch}&sort_order=relevancy&${TWEET_FIELDS}&expansions=author_id&${USER_FIELDS}`,
      { maxPosts: nSearch, maxUsers: nSearch }
    );
    const authors = body?.includes?.users ?? [];
    report.search.push({
      query: q,
      results: body?.data?.length ?? 0,
      uniqueAuthors: authors.length,
      newAuthors: authors
        .filter((a) => !seedHandles.has(a.username.toLowerCase()))
        .sort((a, b) => b.public_metrics.followers_count - a.public_metrics.followers_count)
        .map((a) => ({ handle: a.username, followers: a.public_metrics.followers_count, bio: a.description.slice(0, 90) })),
    });
  }
} catch (e) {
  console.error(e.message);
}

// --- Report -------------------------------------------------------------------

const cost = used.posts * RATE_POST + used.users * RATE_USER;
const fetched = report.seeds.reduce((s, a) => s + a.fetched, 0) || 1;
const sum = (key) => report.seeds.reduce((s, a) => s + a[key], 0);
const perDay = report.seeds.map((a) => a.perDay).filter((v) => v != null);
const avgPerDay = perDay.length ? perDay.reduce((s, v) => s + v, 0) / perDay.length : null;
report.usage = { ...used, estimatedCost: +cost.toFixed(2) };
report.summary = {
  replyShare: +(sum('replies') / fetched).toFixed(2),
  quoteShare: +(sum('quotes') / fetched).toFixed(2),
  annotatedShare: +(sum('withAnnotations') / fetched).toFixed(2),
  avgTweetsPerDay: avgPerDay && +avgPerDay.toFixed(1),
  // Round 0 for every seed at 30 tweets each, at the assumed rates above.
  round0Estimate: +((seeds.length * 30 * RATE_POST + seeds.length * RATE_USER)).toFixed(2),
};
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

console.log(`\nRequests ${used.requests} · posts read ${used.posts} · users read ${used.users} · estimated $${cost.toFixed(2)}`);
if (report.notFound.length) console.log(`Not found: ${report.notFound.join(', ')}`);
console.log('Summary:', report.summary);
console.log(`Mention candidates: ${(report.mentionCandidates ?? []).map((c) => `${c.handle}(${c.seeds.length})`).join(', ') || 'none'}`);
for (const s of report.search) console.log(`Search "${s.query}": ${s.results} results, ${s.newAuthors.length} new authors`);
console.log(`Full report: ${path.join(outDir, 'report.json')}`);
