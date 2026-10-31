// Live pipeline, step 2: Claude reads every stored post it hasn't read yet (from the last week): is it about
// AI, a short topic phrase, and its outlook and belief when it takes a stance. Runs on Claude Code.
//
//   npm run live-score

import { readPosts } from './lib/analysis.mjs';
import { loadPosts, loadReads, saveReads } from './lib/live.mjs';

const CHUNK = 80;
const PARALLEL = 3;
const WEEK = 7 * 24 * 3600e3;

const reads = loadReads();
const todo = loadPosts(Date.now() - WEEK, Date.now()).filter((p) => !reads.has(p.id));
const chunks = [];
for (let k = 0; k < todo.length; k += CHUNK) chunks.push(todo.slice(k, k + CHUNK));
console.log(`Reading ${todo.length} new posts in ${chunks.length} chunks`);

let next = 0;
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (next < chunks.length) {
      const k = next++;
      for (const r of await readPosts(chunks[k], `chunk ${k}`)) reads.set(r.id, { ai: r.ai, topic: r.topic, outlook: r.outlook, belief: r.belief });
      saveReads(reads);
      console.log(`  chunk ${k + 1}/${chunks.length} done`);
    }
  })
);
