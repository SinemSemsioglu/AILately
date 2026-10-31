// The live store: everything the hourly pipeline has collected, kept in data/raw/live/.
//   posts/<YYYY-MM-DD>.json  posts by the UTC day they were written: { id: post }
//   reads.json               Claude's reading of each post: { id: { ai, topic, outlook, belief } }
//   topics.json              the topic registry: { topics: { key: { name, summary, section, created } },
//                            phrases: { phrase: key }, next }
//   state.json               when each source was last fetched, and money spent

import fs from 'node:fs';
import path from 'node:path';

export const LIVE = 'data/raw/live';
const POSTS = path.join(LIVE, 'posts');
fs.mkdirSync(POSTS, { recursive: true });

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}
function writeJson(file, data) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}

const dayOf = (iso) => iso.slice(0, 10);

// Add or update posts (an update keeps the first fetch time and refreshes the metrics).
export function savePosts(posts) {
  const now = new Date().toISOString();
  for (const [day, list] of Object.entries(Object.groupBy(posts, (p) => dayOf(p.created_at)))) {
    const file = path.join(POSTS, `${day}.json`);
    const stored = readJson(file, {});
    for (const p of list) stored[p.id] = { ...stored[p.id], ...p, fetched: stored[p.id]?.fetched ?? now, metricsAt: now };
    writeJson(file, stored);
  }
}

// Every post written between two times (ms).
export function loadPosts(from, to) {
  const out = [];
  for (let t = from - 86400e3; t <= to + 86400e3; t += 86400e3) {
    const stored = readJson(path.join(POSTS, `${dayOf(new Date(t).toISOString())}.json`), {});
    for (const p of Object.values(stored)) {
      const at = Date.parse(p.created_at);
      if (at >= from && at < to) out.push(p);
    }
  }
  return [...new Map(out.map((p) => [p.id, p])).values()];
}

export const loadReads = () => new Map(Object.entries(readJson(path.join(LIVE, 'reads.json'), {})));
export const saveReads = (reads) => writeJson(path.join(LIVE, 'reads.json'), Object.fromEntries(reads));

export const loadTopics = () => readJson(path.join(LIVE, 'topics.json'), { topics: {}, phrases: {}, next: 0 });
export const saveTopics = (registry) => writeJson(path.join(LIVE, 'topics.json'), registry);

export const loadState = () => readJson(path.join(LIVE, 'state.json'), { spent: 0 });
export const saveState = (state) => writeJson(path.join(LIVE, 'state.json'), state);
