// The sources besides X: Hacker News, Bluesky search, Hugging Face Daily Papers, company / community /
// news feeds, Anthropic's news page, Manifold prediction markets and Finnhub stock quotes. Public APIs and
// feeds, fetched plainly; stocks need FINNHUB_API_KEY in .env (skipped without it). Shared by
// fetch-sources.mjs (a fixed window) and live-sources.mjs (the hourly pipeline).

import { HN_MIN_POINTS, BLUESKY_MIN_LIKES, BLUESKY_QUERIES, PAPERS_MIN_UPVOTES, FEEDS, STOCKS } from '../../src/data/sources.js';

export { STOCKS };
const HEADERS = { 'User-Agent': 'ai-lately (personal research project)' };

async function get(url, as = 'json') {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === 'json' ? await res.json() : await res.text();
    } catch (e) {
      if (attempt >= 3) {
        console.warn(`  gave up on ${url}: ${e.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const decode = (s = '') =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const tag = (block, name) => block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];

// RSS <item> and Atom <entry> alike: title, link, date, a short description.
function parseFeed(xml) {
  return [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)].map(([block]) => ({
    title: decode(tag(block, 'title')),
    url: decode(tag(block, 'link')) || block.match(/<link[^>]*href="([^"]+)"/)?.[1] || '',
    time: Date.parse(decode(tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated') ?? '')),
    summary: decode(tag(block, 'description') ?? tag(block, 'summary') ?? '').slice(0, 300),
  }));
}


// Every item written between two times (ms): { source, kind, title, url, time, score?, … }.
export async function fetchItems(from, to) {
  const inWindow = (t) => t >= from && t <= to;
  const items = [];

  // Hacker News (Algolia search API) -------------------------------------------------------------
  {
    const q = new URLSearchParams({
      tags: 'story',
      numericFilters: `created_at_i>${Math.floor(from / 1000)},created_at_i<${Math.floor(to / 1000)},points>${HN_MIN_POINTS}`,
      hitsPerPage: '1000',
    });
    const d = await get(`https://hn.algolia.com/api/v1/search?${q}`);
    for (const h of d?.hits ?? []) {
      items.push({
        source: 'Hacker News',
        kind: 'forum',
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        discussion: `https://news.ycombinator.com/item?id=${h.objectID}`,
        time: h.created_at_i * 1000,
        score: h.points,
        comments: h.num_comments,
      });
    }
    console.log(`Hacker News: ${d?.hits?.length ?? 0} stories with ${HN_MIN_POINTS}+ points`);
  }

  // --- Bluesky (public search API; no key) -----------------------------------------------------------
  // The most-liked posts matching AI terms. Like X posts, their text is only used to merge them into
  // topics; the page shows author and link.
  {
    const seen = new Set();
    for (const q of BLUESKY_QUERIES) {
      // One page per query: without signing in, Bluesky refuses the next pages.
      {
        const params = new URLSearchParams({ q, sort: 'top', limit: '100', since: new Date(from).toISOString(), until: new Date(to).toISOString() });
        const d = await get(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params}`);
        for (const p of d?.posts ?? []) {
          if (seen.has(p.uri) || p.likeCount < BLUESKY_MIN_LIKES || p.record?.reply) continue;
          seen.add(p.uri);
          const author = p.author.displayName || p.author.handle;
          items.push({
            source: 'Bluesky',
            kind: 'social',
            title: `Post by ${author} (@${p.author.handle})`,
            summary: (p.record?.text ?? '').slice(0, 300),
            url: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split('/').pop()}`,
            time: Date.parse(p.record?.createdAt ?? p.indexedAt),
            score: p.likeCount,
            comments: p.replyCount,
          });
        }
      }
    }
    console.log(`Bluesky: ${seen.size} posts with ${BLUESKY_MIN_LIKES}+ likes`);
  }

  // --- Hugging Face Daily Papers -----------------------------------------------------------------------
  {
    let n = 0;
    for (let t = from; t <= to + 86400e3; t += 86400e3) {
      const date = new Date(t).toISOString().slice(0, 10);
      for (const p of (await get(`https://huggingface.co/api/daily_papers?date=${date}`)) ?? []) {
        if (p.paper.upvotes < PAPERS_MIN_UPVOTES) continue;
        items.push({
          source: 'HF Daily Papers',
          kind: 'papers',
          title: p.title ?? p.paper.title,
          summary: (p.summary ?? p.paper.summary ?? '').slice(0, 300),
          url: `https://huggingface.co/papers/${p.paper.id}`,
          time: Date.parse(p.publishedAt),
          score: p.paper.upvotes,
          comments: p.numComments,
        });
        n++;
      }
    }
    console.log(`HF Daily Papers: ${n} papers with ${PAPERS_MIN_UPVOTES}+ upvotes`);
  }

  // --- Feeds ------------------------------------------------------------------------------------------
  for (const [source, kind, url] of FEEDS) {
    const xml = await get(url, 'text');
    const posts = xml ? parseFeed(xml).filter((p) => inWindow(p.time)) : [];
    for (const p of posts) items.push({ source, kind, ...p });
    console.log(`${source}: ${posts.length} in window`);
  }

  // --- Anthropic (no feed: its news page lists posts with dates) -------------------------------------
  {
    const html = await get('https://www.anthropic.com/news', 'text');
    const posts = [];
    for (const m of html?.matchAll(/href="(\/news\/[a-z0-9-]+)"[\s\S]{0,600}?(\w{3} \d{1,2}, \d{4})/g) ?? []) {
      const time = Date.parse(m[2]);
      const slug = m[1].split('/').pop();
      if (inWindow(time + 12 * 3600e3) && !posts.some((p) => p.url.endsWith(slug)))
        posts.push({ source: 'Anthropic', kind: 'company', title: slug.replace(/-/g, ' '), url: `https://www.anthropic.com${m[1]}`, time });
    }
    items.push(...posts);
    console.log(`Anthropic: ${posts.length} in window (titles from URLs)`);
  }
  return items;
}

// Open binary AI markets on Manifold, as they stand now.
export async function fetchMarkets() {
  const markets = [];
  for (const term of ['AI', 'AGI', 'OpenAI', 'Anthropic', 'LLM']) {
    const d = await get(
      `https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(term)}&sort=most-popular&limit=20&filter=open`
    );
    for (const m of d ?? []) {
      if (markets.some((x) => x.id === m.id) || m.outcomeType !== 'BINARY') continue;
      markets.push({
        id: m.id,
        source: 'Manifold',
        question: m.question,
        url: m.url,
        probability: m.probability,
        traders: m.uniqueBettorCount,
        volume: m.volume,
        closes: m.closeTime,
      });
    }
  }
  console.log(`Manifold: ${markets.length} open AI markets`);
  return markets;
}

// The latest quote for each AI stock (Finnhub's free plan has no history: price and change on the
// previous close).
export async function fetchStocks() {
  const stocks = [];
  const key = process.env.FINNHUB_API_KEY;
  if (key) {
    for (const [symbol, name, about] of STOCKS) {
      const q = await get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`);
      if (q?.c) stocks.push({ symbol, name, about, price: q.c, change: q.dp, time: q.t * 1000 });
    }
    console.log(`Finnhub: ${stocks.length} quotes`);
  } else console.log('Finnhub: skipped (no FINNHUB_API_KEY)');
  return stocks;
}
