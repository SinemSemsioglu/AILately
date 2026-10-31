// Gather the X profiles of every account on the main map into data/profiles.json (name, bio, followers,
// posts), from the profile files fetched so far (data/raw/round0/profiles-*.json). That file is kept in the
// repo so the hourly job can build the map without the raw data.
//
//   npm run save-profiles

import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/raw/round0';
const all = new Map();
for (const f of fs.readdirSync(DIR).filter((f) => /^profiles-.*\.json$/.test(f))) {
  for (const u of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).data ?? []) {
    all.set(u.username.toLowerCase(), {
      username: u.username,
      name: u.name,
      description: u.description ?? '',
      public_metrics: { followers_count: u.public_metrics.followers_count, tweet_count: u.public_metrics.tweet_count },
    });
  }
}
const onMap = new Set(JSON.parse(fs.readFileSync('src/data/atlas.json', 'utf8')).accounts.map((a) => a.handle.toLowerCase()));
const kept = [...all.values()].filter((u) => onMap.has(u.username.toLowerCase())).sort((a, b) => a.username.localeCompare(b.username));
fs.writeFileSync('data/profiles.json', JSON.stringify({ data: kept }).replace(/\},\{/g, '},\n{'));
console.log(`${kept.length} profiles → data/profiles.json`);
