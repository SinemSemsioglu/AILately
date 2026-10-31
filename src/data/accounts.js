// The map's groups, and every account on the map (from X, via scripts/build-atlas.mjs → atlas.json).
import atlas from './atlas.js';

export const REGIONS = [
  { id: 'frontier', label: 'Frontier Labs' },
  { id: 'research', label: 'Research' },
  { id: 'builders', label: 'Builders & Open Source' },
  { id: 'creative', label: 'Creative AI' },
  { id: 'discourse', label: 'Commentary & Discourse' },
  { id: 'safety', label: 'Safety & Policy' },
];

// { handle, name, type, region, followers, tweets (lifetime), bio, source }
export const ACCOUNTS = atlas.accounts;

// The days the posts behind topics, moods and interests come from.
export const DATA_WINDOW = atlas.window;
