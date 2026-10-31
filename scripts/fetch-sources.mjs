// Collect what the rest of the web said about AI in Round 0's window, for the front page: Hacker News
// stories, Bluesky posts, Hugging Face Daily Papers, company / community / news blog posts (lib/sources.mjs),
// prediction markets and AI stock quotes. Stocks need FINNHUB_API_KEY in .env (skipped without it).
//
//   npm run fetch-sources
//
// Output: data/raw/sources/items.json (one list, every item with source, title, url, time and a score)
// data/raw/sources/markets.json and data/raw/sources/stocks.json. Re-runnable: items add to earlier runs'
// (feeds forget old posts); markets and stocks are replaced.

import fs from 'node:fs';
import path from 'node:path';
import { fetchItems, fetchMarkets, fetchStocks } from './lib/sources.mjs';

const OUT = 'data/raw/sources';
const state = JSON.parse(fs.readFileSync('data/raw/round0/state.json', 'utf8'));
const from = Date.parse(state.startTime);
const to = Date.parse(state.endTime);
const inWindow = (t) => t >= from && t <= to;

const items = await fetchItems(from, to);
const markets = await fetchMarkets();
const stocks = await fetchStocks();

// Feeds only list their latest posts, so a later run can miss items an earlier one found: keep every
// earlier in-window item (from items.json, or merged.json if an earlier merge holds more) that this run
// didn't find again.
fs.mkdirSync(OUT, { recursive: true });
const found = new Set(items.map((it) => it.url));
for (const file of ['items.json', 'merged.json']) {
  const f = path.join(OUT, file);
  if (!fs.existsSync(f)) continue;
  const earlier = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const { topic, story, ...it } of Array.isArray(earlier) ? earlier : earlier.items) {
    if (found.has(it.url) || !inWindow(it.time)) continue;
    found.add(it.url);
    items.push(it);
  }
}
fs.writeFileSync(path.join(OUT, 'items.json'), JSON.stringify(items, null, 1));
fs.writeFileSync(path.join(OUT, 'markets.json'), JSON.stringify(markets, null, 1));
if (stocks.length) fs.writeFileSync(path.join(OUT, 'stocks.json'), JSON.stringify(stocks, null, 1));
console.log(`\n${items.length} items → ${OUT}/items.json`);
