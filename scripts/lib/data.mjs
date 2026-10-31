// Shared file helpers for the data scripts.

import fs from 'node:fs';
import path from 'node:path';

// Which dataset the scripts work on: Round 0 (the curated AI accounts) by default, or another one, such as
// the accounts a person follows (DATASET=<handle>), kept in data/raw/<dataset>/ and built into
// src/data/atlas-<dataset>.json.
export const DATASET = process.env.DATASET ?? 'round0';
export const RAW = `data/raw/${DATASET}`;
// Live datasets (live-day, live-3d, live-week; scripts/live-build.mjs) cover Round 0's accounts.
export const ROUND0_ACCOUNTS = DATASET === 'round0' || DATASET.startsWith('live-');
export const ATLAS = DATASET === 'round0' ? 'src/data/atlas.json' : `src/data/atlas-${DATASET}.json`;

// The map's groups, as described to Claude when sorting accounts.
export const GROUP_DESCRIPTIONS = {
  frontier: 'frontier labs and their leaders (OpenAI, Anthropic, DeepMind, Meta AI, xAI, Mistral, Qwen, DeepSeek…)',
  research: 'researchers, academics, research orgs and conferences; robotics research belongs here too',
  builders: 'builders: engineers, open source, developer tools, AI products and infrastructure companies',
  creative: 'creative AI: image, video, music, art and design tools and the people making them',
  discourse: 'commentary: investors, journalists, writers, podcasters, AI news and educators',
  safety: 'safety, alignment, governance and policy: researchers, orgs, advocates and critics',
};

// A small CSV reader that handles quoted fields (commas, quotes and newlines inside them).
export function readCsv(file) {
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

export function writeCsv(file, rows) {
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

// Every X profile for the dataset, keyed by lowercase username: for the main map, data/profiles.json (kept in
// the repo, so the hourly job has them; refresh with npm run save-profiles); for a following-list dataset,
// its own data/raw/<dataset>/profiles-*.json.
export function loadProfiles() {
  const profiles = new Map();
  const files = ROUND0_ACCOUNTS
    ? ['data/profiles.json']
    : fs.readdirSync(RAW).filter((f) => /^profiles-.*\.json$/.test(f)).map((f) => path.join(RAW, f));
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const u of JSON.parse(fs.readFileSync(file, 'utf8')).data ?? []) profiles.set(u.username.toLowerCase(), u);
  }
  return profiles;
}

// Each account's map group, by lowercase handle ('exclude' for accounts kept off the map). In Round 0, seeds
// keep their curated region (robotics is merged into research) and candidates use their classified group;
// other datasets use their classified accounts (scripts/classify-following.mjs).
export function loadGroups() {
  const groups = new Map();
  if (!ROUND0_ACCOUNTS) {
    for (const a of loadAccounts()) groups.set(a.handle.toLowerCase(), a.group);
    return groups;
  }
  for (const s of readCsv('data/seeds.csv')) groups.set(s.handle.toLowerCase(), s.region === 'robotics' ? 'research' : s.region);
  for (const c of readCsv('data/candidates.csv')) if (c.group) groups.set(c.handle.toLowerCase(), c.group);
  for (const b of loadBlueskyAccounts()) groups.set(b.handle.toLowerCase(), b.group);
  return groups;
}

// Accounts found on Bluesky that aren't in our X list (scripts/explore-bluesky.mjs), keyed by their
// Bluesky handle; 'exclude' for those kept off the map.
export function loadBlueskyAccounts() {
  return fs.existsSync('data/bluesky-accounts.json') ? JSON.parse(fs.readFileSync('data/bluesky-accounts.json', 'utf8')).filter((b) => b.group) : [];
}

// A non-Round-0 dataset's classified accounts: [{ handle, group, type, reason }].
export function loadAccounts() {
  return JSON.parse(fs.readFileSync(path.join(RAW, 'accounts.json'), 'utf8'));
}
