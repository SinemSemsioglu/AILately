// Free exploration: for every X account in seeds.csv + candidates.csv, look for its GitHub and
// Hugging Face accounts, and record how sure each match is plus that platform's metrics.
//
//   npm run explore-links              # reads GITHUB_TOKEN from .env; Hugging Face needs no token
//   npm run explore-links -- --limit 20
//
// Match confidence:
//   confirmed — a profile links back to the X handle (GitHub twitter_username / blog / bio, Hugging Face's
//               own X link) or is linked from an already-confirmed profile on the other platform. A Hugging
//               Face profile that only names the X handle must also show real activity, since anyone can
//               type a handle into their profile.
//   probable  — organisations only: the same name on an account with a real following (impostor org
//               accounts rarely have one). Name-only matches for people are never kept: they picked
//               impostors and namesakes for famous people.
// Responses are cached in data/raw/links-cache.json, so re-runs resume instead of re-fetching.
// Output: data/links.json (every account) and a summary on stdout.

import fs from 'node:fs';

const CACHE_FILE = 'data/raw/links-cache.json';
const GH_SEARCH_GAP = 2100; // GitHub search allows 30 requests/minute
const HF_GAP = 400; // be polite to huggingface.co
// An organisation name-only match below this many followers is ignored: squatters and fakes
// ("AnthropicAI" org with 1 follower, "Anthropic-ai-Claude" user) share names with the real accounts.
const MIN_ORG_FOLLOWERS = 1000;
// A Hugging Face profile confirmed only by naming the X handle needs at least this much activity.
const MIN_HF_ACTIVITY = 25; // followers + models + datasets + spaces

const argv = process.argv.slice(2);
const limitArg = argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) : Infinity;

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN is not set (add it to .env).');
  process.exit(1);
}

// --- Input --------------------------------------------------------------------

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

const accounts = [
  ...readCsv('data/seeds.csv').map((s) => ({ handle: s.handle, name: s.name, type: s.type, list: 'seed', website: '' })),
  ...readCsv('data/candidates.csv').map((c) => ({
    handle: c.handle,
    name: c.name,
    type: c.type || (c.their_group === 'company' ? 'org' : 'person'),
    list: 'candidate',
    website: c.website,
  })),
].slice(0, limit);

// --- Helpers ------------------------------------------------------------------

const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
let dirty = 0;
const saveCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastCall = {};

// Fetch once per URL (cached), spaced by `gap` ms per host group; `parse` turns the response into what we keep.
async function cached(key, url, { gap = 0, group = 'x', headers = {}, parse = (r) => r.json() } = {}) {
  if (key in cache) return cache[key];
  const wait = (lastCall[group] ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall[group] = Date.now();
  // Dropped connections happen on long runs, during the request or while reading the body; back off
  // and retry the whole thing a few times.
  let value;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
        const pause = reset ? Math.max(reset - Date.now(), 1000) + 1000 : 60_000;
        console.warn(`  rate limited on ${group}, waiting ${Math.round(pause / 1000)}s`);
        await sleep(pause);
        return cached(key, url, { gap, group, headers, parse });
      }
      value = res.status === 404 ? null : res.ok ? await parse(res) : { error: res.status };
      break;
    } catch (e) {
      // Wait out connection drops and short outages (about 10 minutes in total) before giving up.
      if (attempt >= 14) throw e;
      const wait = Math.min(60, 3 * 2 ** Math.min(attempt, 5)) * 1000;
      console.warn(`  network error on ${group} (${e.cause?.code ?? e.message}), retry ${attempt} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  cache[key] = value;
  if (++dirty % 25 === 0) saveCache();
  return value;
}

const norm = (s) =>
  (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const sameName = (a, b) => !!norm(a) && norm(a) === norm(b);
const linksToX = (text = '', handle) =>
  new RegExp(`(twitter|x)\\.com/${handle}(?![A-Za-z0-9_])`, 'i').test(text);
const domain = (url = '') => {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// --- GitHub -------------------------------------------------------------------

const GH = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
const ghUser = (login) =>
  cached(`gh:user:${login.toLowerCase()}`, `https://api.github.com/users/${login}`, {
    group: 'gh',
    headers: GH,
    parse: async (r) => {
      const d = await r.json();
      return {
        login: d.login,
        type: d.type,
        name: d.name,
        twitter: d.twitter_username,
        blog: d.blog,
        bio: d.bio,
        followers: d.followers,
        repos: d.public_repos,
      };
    },
  });
const ghSearch = (name, isOrg) =>
  cached(
    `gh:search:${isOrg ? 'org' : 'user'}:${norm(name)}`,
    `https://api.github.com/search/users?q=${encodeURIComponent(`"${name}" in:name type:${isOrg ? 'org' : 'user'}`)}&per_page=3`,
    { group: 'ghsearch', gap: GH_SEARCH_GAP, headers: GH, parse: async (r) => (await r.json()).items?.map((i) => i.login) ?? [] }
  );
// Total stars across the account's own (non-fork) repos, from the 100 most-starred.
const ghStars = (login) =>
  cached(
    `gh:stars:${login.toLowerCase()}`,
    `https://api.github.com/users/${login}/repos?per_page=100&sort=stars&type=owner`,
    {
      group: 'gh',
      headers: GH,
      parse: async (r) => (await r.json()).filter?.((x) => !x.fork).reduce((s, x) => s + x.stargazers_count, 0) ?? 0,
    }
  );

function ghVerdict(u, acct) {
  if (!u || u.error) return null;
  if (u.twitter?.toLowerCase() === acct.handle.toLowerCase() || linksToX(u.blog, acct.handle) || linksToX(u.bio, acct.handle))
    return 'confirmed';
  if (acct.website && u.blog && domain(acct.website) === domain(u.blog)) return 'confirmed';
  const org = acct.type !== 'person';
  if (org && (sameName(u.name, acct.name) || sameName(u.login, acct.name)) && u.followers >= MIN_ORG_FOLLOWERS) return 'probable';
  return null;
}

// Prefer confirmed over probable, then the bigger account.
const better = (m, best) =>
  !best ||
  (m.verdict === 'confirmed' && best.verdict !== 'confirmed') ||
  (m.verdict === best.verdict && (m.followers ?? 0) > (best.followers ?? 0));

async function findGitHub(acct) {
  const tried = new Set();
  const consider = async (login) => {
    if (!login || tried.has(login.toLowerCase())) return null;
    tried.add(login.toLowerCase());
    const u = await ghUser(login);
    const verdict = ghVerdict(u, acct);
    return verdict ? { ...u, verdict } : null;
  };
  let best = await consider(acct.handle);
  if (best?.verdict !== 'confirmed' && acct.name) {
    for (const login of (await ghSearch(acct.name, acct.type === 'org')) ?? []) {
      const m = await consider(login);
      if (m && better(m, best)) best = m;
      if (best?.verdict === 'confirmed') break;
    }
  }
  if (best) best.stars = await ghStars(best.login);
  return best;
}

// --- Hugging Face -------------------------------------------------------------

const HF_LINK_KEYS = ['twitter', 'github', 'homepage', 'linkedin', 'bluesky'];
// A profile page embeds the user's own links in a "signup" block (HTML-escaped JSON).
const hfLinks = (username) =>
  cached(`hf:links:${username.toLowerCase()}`, `https://huggingface.co/${username}`, {
    group: 'hf',
    gap: HF_GAP,
    parse: async (r) => {
      const html = (await r.text()).replace(/&quot;/g, '"');
      const block = html.match(/"signup":\{([^}]*)\}/)?.[1] ?? '';
      return Object.fromEntries(
        HF_LINK_KEYS.map((k) => [k, block.match(new RegExp(`"${k}":"([^"]*)"`))?.[1] ?? '']).filter(([, v]) => v)
      );
    },
  });
const hfOverview = (username, isOrg) =>
  cached(
    `hf:${isOrg ? 'org' : 'user'}:${username.toLowerCase()}`,
    `https://huggingface.co/api/${isOrg ? 'organizations' : 'users'}/${username}/overview`,
    {
      group: 'hf',
      gap: HF_GAP,
      parse: async (r) => {
        const d = await r.json();
        return {
          username: d.user ?? d.name,
          name: d.fullname,
          followers: d.numFollowers,
          models: d.numModels,
          datasets: d.numDatasets,
          spaces: d.numSpaces,
          papers: d.numPapers,
          likes: d.numLikes,
        };
      },
    }
  );
const hfSearch = (name) =>
  cached(`hf:search:${norm(name)}`, `https://huggingface.co/api/quicksearch?q=${encodeURIComponent(name)}&type=user&type=org`, {
    group: 'hf',
    gap: HF_GAP,
    parse: async (r) => {
      const d = await r.json();
      return [
        ...(d.users ?? []).map((u) => ({ username: u.user, name: u.fullname, org: false })),
        ...(d.orgs ?? []).map((o) => ({ username: o.name, name: o.fullname, org: true })),
      ];
    },
  });

async function findHuggingFace(acct, github) {
  const isOrg = acct.type === 'org';
  const candidates = [{ username: acct.handle, name: null, org: isOrg }];
  if (acct.name) {
    for (const c of (await hfSearch(acct.name)) ?? []) if (sameName(c.name, acct.name)) candidates.push(c);
  }
  let best = null;
  const seen = new Set();
  for (const c of candidates.slice(0, 4)) {
    if (seen.has(c.username.toLowerCase())) continue;
    seen.add(c.username.toLowerCase());
    const ov = await hfOverview(c.username, c.org);
    if (!ov || ov.error) continue;
    // Only users have the links block; orgs are matched by name.
    const links = c.org ? {} : await hfLinks(c.username);
    const xLink = links.twitter?.replace(/^@/, '').toLowerCase();
    let verdict = null;
    const linksGitHub = github?.verdict === 'confirmed' && links.github?.toLowerCase() === github.login.toLowerCase();
    const activity = (ov.followers ?? 0) + (ov.models ?? 0) + (ov.datasets ?? 0) + (ov.spaces ?? 0);
    if (linksGitHub) verdict = 'confirmed';
    else if (xLink === acct.handle.toLowerCase() && activity >= MIN_HF_ACTIVITY) verdict = 'confirmed';
    else if (c.org && sameName(ov.name, acct.name) && !(xLink && xLink !== acct.handle.toLowerCase()) && ov.followers >= MIN_ORG_FOLLOWERS)
      verdict = 'probable';
    const m = verdict && { ...ov, org: c.org, links, verdict };
    if (m && better(m, best)) best = m;
    if (best?.verdict === 'confirmed') break;
  }
  return best;
}

// --- Run ----------------------------------------------------------------------

// Keep whatever was fetched if the run stops early.
process.on('exit', saveCache);

const results = [];
const started = Date.now();
for (const [k, acct] of accounts.entries()) {
  let github = await findGitHub(acct);
  const hf = await findHuggingFace(acct, github);
  // A confirmed Hugging Face profile that names a GitHub account confirms that one too.
  if (hf?.verdict === 'confirmed' && hf.links?.github && github?.login?.toLowerCase() !== hf.links.github.toLowerCase()) {
    const u = await ghUser(hf.links.github);
    if (u && !u.error) github = { ...u, verdict: 'confirmed', stars: await ghStars(u.login) };
  } else if (hf?.verdict === 'confirmed' && github && hf.links?.github?.toLowerCase() === github.login.toLowerCase()) {
    github.verdict = 'confirmed';
  }
  results.push({ ...acct, github, huggingface: hf });
  if ((k + 1) % 20 === 0 || k === accounts.length - 1) {
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`[${k + 1}/${accounts.length}] ${mins} min`);
  }
}
saveCache();
fs.writeFileSync('data/links.json', JSON.stringify(results, null, 2));

// --- Summary ------------------------------------------------------------------

const count = (pred) => results.filter(pred).length;
const pct = (n) => `${n} (${Math.round((100 * n) / results.length)}%)`;
const people = results.filter((r) => r.type === 'person');
console.log(`\n${results.length} accounts (${people.length} people)`);
for (const [label, key] of [
  ['GitHub', 'github'],
  ['Hugging Face', 'huggingface'],
]) {
  console.log(
    `${label}: confirmed ${pct(count((r) => r[key]?.verdict === 'confirmed'))}, probable ${pct(count((r) => r[key]?.verdict === 'probable'))}`
  );
}
console.log(
  `On all three (confirmed): ${pct(count((r) => r.github?.verdict === 'confirmed' && r.huggingface?.verdict === 'confirmed'))}`
);
console.log('Wrote data/links.json');
