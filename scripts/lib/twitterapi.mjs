// twitterapi.io: a third-party X data API, ~30× cheaper than X's own. Needs TWITTERAPI_IO_KEY in .env.
// Shared by fetch-following.mjs and the live pipeline.

const API = 'https://api.twitterapi.io/twitter';
export const CREDIT = 0.00001; // dollars (100,000 credits = $1)
const MAX_QUERY = 480; // characters per search query

// A spending tracker: every request adds its cost; `budget` stops requests that would go past it.
export function client({ budget, spent = 0 }) {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) throw new Error('TWITTERAPI_IO_KEY is not set (add it to .env).');
  const self = {
    spent,
    async get(endpoint, params, credits) {
      if (self.spent + credits * CREDIT > budget) throw new Error(`budget of $${budget} reached`);
      const url = `${API}/${endpoint}?${new URLSearchParams(params)}`;
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(url, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(60_000) });
          if (res.status === 401 || res.status === 402 || res.status === 403)
            throw Object.assign(new Error(`HTTP ${res.status}: ${await res.text()}`), { fatal: true });
          if (res.status === 429) throw new Error('rate limited');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json();
          if (body.status === 'error') throw Object.assign(new Error(body.msg || body.message), { fatal: true });
          return body;
        } catch (e) {
          if (e.fatal || attempt >= 6) throw e;
          await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        }
      }
    },
    // Every post matching an advanced search (20 a page), up to maxPages pages.
    async search(query, maxPages = 50) {
      const tweets = [];
      let cursor = '';
      for (let p = 0; p < maxPages; p++) {
        const page = await self.get('tweet/advanced_search', { query, queryType: 'Latest', cursor }, 20 * 15);
        tweets.push(...(page.tweets ?? []));
        self.spent += Math.max(15, (page.tweets?.length ?? 0) * 15) * CREDIT;
        if (!page.has_next_page || !page.tweets?.length) break;
        cursor = page.next_cursor;
      }
      return tweets;
    },
  };
  return self;
}

// Original posts (no replies or reposts) from these handles between two times, as batched from: queries.
export function originalPostQueries(handles, since, until) {
  const suffix = ` -filter:replies -filter:retweets since_time:${Math.floor(since / 1000)} until_time:${Math.floor(until / 1000)}`;
  const queries = [];
  let current = [];
  const query = (hs) => `(${hs.map((h) => `from:${h}`).join(' OR ')})${suffix}`;
  for (const h of handles) {
    if (current.length && query([...current, h]).length > MAX_QUERY) {
      queries.push(query(current));
      current = [h];
    } else current.push(h);
  }
  if (current.length) queries.push(query(current));
  return queries;
}

// A post in the shape the analysis reads (or null for replies and reposts).
export function normalizeTweet(t) {
  if (t.isReply || t.retweeted_tweet) return null;
  return {
    id: t.id,
    platform: 'x',
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
  };
}
