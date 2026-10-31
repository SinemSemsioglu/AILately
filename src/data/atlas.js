// The atlas the pages show: the live last day (atlas-live-day.json) once the live pipeline has built it,
// otherwise Round 0 (atlas.json). ?data=<name> picks another: live-3d, live-week, round0 (25–28 Oct), or a
// following-list dataset (atlas-<handle>.json). Links between pages keep the choice.
const files = import.meta.glob('./atlas*.json', { eager: true, import: 'default' });
const fileOf = (name) => (name === 'round0' ? './atlas.json' : `./atlas-${name}.json`);

export const DEFAULT = files['./atlas-live-day.json'] ? 'live-day' : 'round0';
const asked = new URLSearchParams(location.search).get('data');
export const DATASET = asked && files[fileOf(asked)] ? asked : DEFAULT;
export const has = (name) => !!files[fileOf(name)];
const whole = files[fileOf(DATASET)];

// ?source=x or ?source=bluesky: the atlas as one platform saw it, from the per-platform sums the live
// build keeps (scripts/live-build.mjs). Topics that platform didn't discuss drop out; each remaining
// topic takes that platform's accounts, engagement and mood; towns are the accounts posting there.
export const SOURCES = whole.groupMoodsByPlatform ? Object.keys(whole.groupMoodsByPlatform) : [];
const askedSource = new URLSearchParams(location.search).get('source');
export const SOURCE = SOURCES.includes(askedSource) ? askedSource : null;

// Keep only some topics (each possibly changed by `view`), with participants and interests reindexed;
// accounts that posted about none of them go quiet.
function keepTopics(atlas, keepIt, view = (t) => t, participantsOf = (t, i) => atlas.participants[i]) {
  const keep = atlas.topics.map((t, i) => [t, i]).filter(([t]) => keepIt(t));
  const newIndex = new Map(keep.map(([, i], k) => [i, k]));
  const topics = keep.map(([t]) => view(t));
  const participants = keep.map(([t, i]) => participantsOf(t, i));
  const posting = new Set(participants.flat());
  const interests = atlas.interests.map((list, a) =>
    posting.has(a) ? list.filter(([t]) => newIndex.has(t)).map(([t, w]) => [newIndex.get(t), w]) : []
  );
  return { ...atlas, topics, participants, interests };
}

function onePlatform(atlas, platform) {
  const { topics, participants, interests } = keepTopics(
    atlas,
    (t) => t.byPlatform?.[platform],
    (t) => {
      const { participants: _, ...b } = t.byPlatform[platform];
      return { ...t, ...b, region: b.groups[0]?.[0] ?? t.region };
    },
    (t) => t.byPlatform[platform].participants
  );
  // Groups with no posts on this platform get a neutral mood.
  const moods = atlas.groupMoodsByPlatform[platform];
  const groupMoods = Object.fromEntries(
    Object.keys(atlas.groupMoods).map((g) => [g, moods[g] ?? { outlook: 0, belief: 0, division: 0, posts: 0 }])
  );
  return { ...atlas, topics, participants, interests, groupMoods };
}

// ?stories=niche: only specific discussions that still carry weight (scripts/build-atlas.mjs), ranked as
// niche; stories from elsewhere drop out. Otherwise the small niche-only topics stay off.
export const NICHE_AVAILABLE = whole.topics.some((t) => t.niche);
export const NICHE = NICHE_AVAILABLE && new URLSearchParams(location.search).get('stories') === 'niche';
const bySource = SOURCE ? onePlatform(whole, SOURCE) : whole;
const atlas = NICHE
  ? { ...keepTopics(bySource, (t) => t.niche, (t) => ({ ...t, rank: t.niche })), stories: [] }
  : keepTopics(bySource, (t) => !t.nicheOnly);
export default atlas;

if (DATASET !== DEFAULT || SOURCE || NICHE) {
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="./"]');
    if (!a) return;
    const url = new URL(a.href);
    if (DATASET !== DEFAULT && !url.searchParams.has('data')) url.searchParams.set('data', DATASET);
    if (SOURCE && !url.searchParams.has('source')) url.searchParams.set('source', SOURCE);
    if (NICHE && !url.searchParams.has('stories')) url.searchParams.set('stories', 'niche');
    a.href = url.href;
  });
}
