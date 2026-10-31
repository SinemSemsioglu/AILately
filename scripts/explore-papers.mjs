// Academic records for accounts on the map, from OpenAlex (free, no key).
//
//   npm run explore-papers
//
// Confirmed: an account with a confirmed Hugging Face profile that has claimed papers there. Its claimed
// arXiv papers are looked up on OpenAlex, and the author on them whose name matches the account is that
// person's OpenAlex record. No name guessing across the whole database.
// For review: researchers without claimed papers get a name search on OpenAlex; plausible matches go to
// data/papers-review.csv. Put "yes" in its `approve` column to use a match; nothing else is added.
//
// Responses are cached in data/raw/papers-cache.json (safe to stop and re-run). Output: data/papers.json.

import fs from 'node:fs';
import { readCsv, writeCsv } from './lib/data.mjs';

const CACHE_FILE = 'data/raw/papers-cache.json';
const REVIEW_FILE = 'data/papers-review.csv';
const GAP = 150; // ms between requests (OpenAlex allows 10/s)
const PAPERS_PER_PERSON = 4;
const REVIEW_GROUPS = new Set(['research', 'safety']);

const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
let dirty = 0;
const saveCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
process.on('exit', saveCache);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

// Fetch once per key (cached), politely spaced, retrying through dropped connections and outages.
async function cached(key, url, parse = (r) => r.json()) {
  if (key in cache) return cache[key];
  for (let attempt = 1; ; attempt++) {
    const wait = last + GAP - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }); // a stalled request counts as an error
      if (res.status === 429) {
        await sleep(10_000);
        continue;
      }
      const value = res.status === 404 ? null : res.ok ? await parse(res) : { error: res.status };
      cache[key] = value;
      if (++dirty % 20 === 0) saveCache();
      return value;
    } catch (e) {
      if (attempt >= 14) throw e;
      const pause = Math.min(60, 3 * 2 ** Math.min(attempt, 5)) * 1000;
      console.warn(`  network error (${e.cause?.code ?? e.message}), retry ${attempt} in ${pause / 1000}s`);
      await sleep(pause);
    }
  }
}

const norm = (s) =>
  (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L} ]/gu, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
// Same person's name: same last name and same first initial ("Christopher D. Manning" ~ "Chris Manning").
function sameName(a, b) {
  const x = norm(a);
  const y = norm(b);
  return x.length > 1 && y.length > 1 && x.at(-1) === y.at(-1) && x[0][0] === y[0][0];
}

// Claimed papers on a Hugging Face profile page (embedded as HTML-escaped JSON).
const claimedPapers = (username) =>
  cached(`hf:papers:${username.toLowerCase()}`, `https://huggingface.co/${username}`, async (r) => {
    const html = (await r.text()).replace(/&quot;/g, '"');
    const block = html.match(/"papers":\[(.*?)\],"/)?.[1] ?? '';
    return [...block.matchAll(/"id":"(\d{4}\.\d{4,5})"/g)].map((m) => m[1]);
  });

const work = (arxiv) =>
  cached(`oa:work:${arxiv}`, `https://api.openalex.org/works/doi:10.48550/arXiv.${arxiv}`, async (r) => {
    const d = await r.json();
    // Some authorships have no resolved author; skip those.
    return (d.authorships ?? [])
      .filter((a) => a.author?.id)
      .map((a) => ({ id: a.author.id.split('/').pop(), name: a.author.display_name }));
  });

const author = (id) =>
  cached(`oa:author:${id}`, `https://api.openalex.org/authors/${id}`, async (r) => {
    const d = await r.json();
    return {
      id,
      name: d.display_name,
      works: d.works_count,
      citations: d.cited_by_count,
      hIndex: d.summary_stats?.h_index ?? 0,
      institution: d.last_known_institutions?.[0]?.display_name ?? '',
    };
  });

const search = (name) =>
  cached(
    `oa:search:${norm(name).join(' ')}`,
    `https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per_page=5`,
    async (r) =>
      ((await r.json()).results ?? []).map((d) => ({
        id: d.id.split('/').pop(),
        name: d.display_name,
        works: d.works_count,
        citations: d.cited_by_count,
        hIndex: d.summary_stats?.h_index ?? 0,
        institution: d.last_known_institutions?.[0]?.display_name ?? '',
        topics: (d.topics ?? []).slice(0, 3).map((t) => t.display_name),
      }))
  );

// --- Run ----------------------------------------------------------------------------------------

const links = JSON.parse(fs.readFileSync('data/links.json', 'utf8'));
const atlas = JSON.parse(fs.readFileSync('src/data/atlas.json', 'utf8'));
const papers = {};

// 1. Confirmed through Hugging Face claimed papers.
const claimers = links.filter(
  (r) => r.type === 'person' && r.huggingface?.verdict === 'confirmed' && !r.huggingface.org && r.huggingface.papers > 0
);
console.log(`${claimers.length} accounts with claimed papers on Hugging Face`);
for (const r of claimers) {
  const ids = (await claimedPapers(r.huggingface.username)) ?? [];
  const votes = new Map();
  for (const arxiv of ids.slice(0, PAPERS_PER_PERSON)) {
    for (const a of (await work(arxiv)) ?? []) {
      if (sameName(a.name, r.name) || sameName(a.name, r.huggingface.name)) votes.set(a.id, (votes.get(a.id) ?? 0) + 1);
    }
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  if (!best) continue;
  const stats = await author(best[0]);
  if (stats && !stats.error) papers[r.handle] = { ...stats, verdict: 'confirmed', via: 'huggingface papers' };
}
console.log(`confirmed: ${Object.keys(papers).length}`);

// 2. Researchers without claimed papers: name search, for review.
const reviewed = new Map(
  fs.existsSync(REVIEW_FILE) ? readCsv(REVIEW_FILE).map((r) => [r.handle.toLowerCase(), r]) : []
);
const review = [];
for (const a of atlas.accounts) {
  if (a.type !== 'person' || !REVIEW_GROUPS.has(a.region) || papers[a.handle]) continue;
  const hits = ((await search(a.name)) ?? []).filter((h) => sameName(h.name, a.name) && h.works >= 5);
  if (!hits.length) continue;
  const h = hits.sort((x, y) => y.citations - x.citations)[0];
  const prev = reviewed.get(a.handle.toLowerCase());
  const approve = prev?.openalex === h.id ? prev.approve : '';
  review.push({
    handle: a.handle,
    name: a.name,
    openalex: h.id,
    openalex_name: h.name,
    works: h.works,
    citations: h.citations,
    h_index: h.hIndex,
    institution: h.institution,
    topics: h.topics.join('; '),
    bio: a.bio,
    approve,
  });
  if (approve.toLowerCase() === 'yes') papers[a.handle] = { ...h, verdict: 'approved', via: 'name search, reviewed' };
}
if (review.length) writeCsv(REVIEW_FILE, review);

fs.writeFileSync('data/papers.json', JSON.stringify(papers, null, 1));
saveCache();
console.log(`for review: ${review.length} (in ${REVIEW_FILE}; mark approve=yes to use)`);
console.log(`papers.json: ${Object.keys(papers).length} accounts`);
