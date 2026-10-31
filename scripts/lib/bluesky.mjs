// Reading Bluesky through its public API (no account needed).

const API = 'https://api.bsky.app/xrpc';

async function get(method, params) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}/${method}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(20_000) });
      if (res.status === 400) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 4) {
        console.warn(`  Bluesky ${method} gave up: ${e.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// A Bluesky post id as we store it, and the link back to the post.
export const postId = (uri) => `bsky:${uri.replace('at://', '').replace('/app.bsky.feed.post/', '/')}`;
export const postUrl = (id) => {
  const [did, rkey] = id.slice(5).split('/');
  return `https://bsky.app/profile/${did}/post/${rkey}`;
};

// One account's original posts (no replies or reposts) since a time, newest first, in the shape the
// analysis reads; `author` is our handle for the account, so the posts join its town.
export async function authorPosts(did, author, since) {
  const posts = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const d = await get('app.bsky.feed.getAuthorFeed', { actor: did, filter: 'posts_no_replies', limit: 100, ...(cursor ? { cursor } : {}) });
    if (!d?.feed?.length) break;
    for (const { post, reason } of d.feed) {
      if (reason || post.record?.reply) continue; // a repost, or a reply
      const at = Date.parse(post.record?.createdAt ?? post.indexedAt);
      if (at < since) continue;
      posts.push({
        id: postId(post.uri),
        platform: 'bluesky',
        author,
        created_at: new Date(at).toISOString(),
        text: post.record?.text ?? '',
        metrics: {
          like_count: post.likeCount ?? 0,
          retweet_count: post.repostCount ?? 0,
          reply_count: post.replyCount ?? 0,
          quote_count: post.quoteCount ?? 0,
        },
        links: (post.record?.facets ?? []).flatMap((f) => f.features ?? []).map((f) => f.uri).filter(Boolean),
      });
    }
    const oldest = Date.parse(d.feed.at(-1).post.indexedAt);
    if (oldest < since || !d.cursor) break;
    cursor = d.cursor;
  }
  return posts;
}
