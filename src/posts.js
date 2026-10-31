// Links out to posts, shared by the map and the front page.

// A post's link: X ids are numbers; Bluesky ids are bsky:<did>/<rkey> (scripts/lib/bluesky.mjs).
export function postLink(id) {
  if (!id.startsWith('bsky:')) return `https://x.com/i/web/status/${id}`;
  const [did, rkey] = id.slice(5).split('/');
  return `https://bsky.app/profile/${did}/post/${rkey}`;
}

export const shortCount = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));

// How another source's item is named in a list of links: "Hacker News · 562 pts", "OpenAI blog", …
export function sourceLabel(it) {
  if (it.source === 'Hacker News') return `Hacker News · ${it.score} pts`;
  if (it.source === 'Bluesky') return `Bluesky · ${shortCount(it.score)} likes`;
  if (it.kind === 'papers') return `${it.source} · ${it.score} upvotes`;
  return it.kind === 'company' ? `${it.source} blog` : it.source;
}
