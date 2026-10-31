// Topics people discussed in the data window, found by Claude from X posts (scripts/analyze.mjs).
// groups:     share of the topic's authors from each group, biggest first; the first decides `region`
// tweets:     how many posts were about it; authors: how many different accounts
// engagement: likes + reposts + replies + quotes, counting each author's best three posts only
// mood:       outlook (-1 worried … 1 hopeful), belief (-1 sceptical … 1 believer), division (0 … 1),
//             camps: [[camp outlook, [main groups]], …] when hopeful and worried camps both exist
// query:      X search used when the topic is clicked
import atlas from './atlas.js';

export const TOPICS = atlas.topics;

// From other sources (Hacker News, blogs, news), merged by Claude (scripts/merge-sources.mjs):
// STORIES are AI stories X didn't surface; MARKETS are prediction markets, tied to topics where relevant.
// Each topic also carries `elsewhere`: links about it from those sources.
export const STORIES = atlas.stories ?? [];
export const MARKETS = atlas.markets ?? [];
