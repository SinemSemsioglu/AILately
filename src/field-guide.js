// The Field guide: what the groups are, what the mood words mean, how things are measured, and what to be
// careful about. Examples come from the current data.
import { ACCOUNTS, REGIONS, DATA_WINDOW } from './data/accounts.js';
import { TOPICS } from './data/topics.js';
import { GROUPS, TERMS, installDefinitions } from './glossary.js';
import { FEEDS, STOCKS, HN_MIN_POINTS, BLUESKY_MIN_LIKES, BLUESKY_QUERIES, PAPERS_MIN_UPVOTES } from './data/sources.js';

const EXAMPLES = 6; // example accounts per group

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const day = (iso, opts) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', ...opts });
const mapLink = (name) => `./index.html?pin=${encodeURIComponent(name)}`;
const topicLink = (t) => `<a href="${mapLink(t.name)}">${esc(t.name)}</a>`;

// Topics at each end of a mood axis, among those with a few stance-taking posts behind them.
const scored = TOPICS.filter((t) => (t.mood.scored ?? 0) >= 3);
const ends = (key) => {
  const sorted = [...scored].sort((a, b) => a.mood[key] - b.mood[key]);
  return [sorted.slice(0, 2), sorted.slice(-2).reverse()];
};

function groups() {
  return REGIONS.map((r) => {
    const g = GROUPS[r.id];
    const examples = ACCOUNTS.filter((a) => a.region === r.id)
      .sort((a, b) => b.followers - a.followers)
      .slice(0, EXAMPLES)
      .map((a) => `<a href="${mapLink(a.name)}">${esc(a.name)}</a>`);
    const count = ACCOUNTS.filter((a) => a.region === r.id).length;
    return `<h3 id="${r.id}">${g.name}</h3>
      <p>${g.long}</p>
      <div class="examples">${count} accounts, including ${examples.join(', ')}</div>`;
  }).join('');
}

function axis(key, low, high) {
  const [lowEnd, highEnd] = ends(key);
  return `<h3 id="${key}">${TERMS[key].name}</h3>
    <p>${TERMS[key].short}</p>
    <div class="axis">
      <div><b id="${low}">${TERMS[low]?.name ?? 'Agreed'}</b>${TERMS[low]?.short ?? 'Most posts lean the same way.'}<br>e.g. ${lowEnd.map(topicLink).join(', ')}</div>
      <div><b id="${high}">${TERMS[high].name}</b>${TERMS[high].short}<br>e.g. ${highEnd.map(topicLink).join(', ')}</div>
    </div>`;
}

const feedNames = (kind) => FEEDS.filter(([, k]) => k === kind).map(([name]) => esc(name)).join(', ');
// How the accounts came onto the list.
function accountMix() {
  const n = (pred) => ACCOUNTS.filter(pred).length;
  const parts = [
    [n((a) => a.source === 'seed'), 'chosen by hand'],
    [n((a) => a.source !== 'seed' && a.source !== 'bluesky' && a.source !== 'community-follows'), 'found through who those follow'],
    [n((a) => a.source === 'community-follows'), "from a community member's follows"],
    [n((a) => a.source === 'bluesky'), 'found on Bluesky through who our accounts follow there'],
  ].filter(([k]) => k);
  return parts.length ? `: ${parts.map(([k, what]) => `${k} ${what}`).join(', ')}` : '';
}

const dates = `${day(DATA_WINDOW.from)}–${day(DATA_WINDOW.to, { month: 'long', year: 'numeric' })}`;

document.getElementById('page').innerHTML = `
  <header class="masthead">
    <nav><a href="./index.html">Map</a><a href="./dashboard.html">Today</a><a class="here" href="./field-guide.html">Field guide</a></nav>
    <h1>Field guide</h1>
    <div class="dateline"><span>How to read AI Lately · data from ${dates}</span></div>
  </header>

  <div class="guide">
    <section>
      <h2>What this is</h2>
      <p>AI Lately maps the conversation about AI. On the <a href="./index.html">map</a>, people and organisations
      are towns and the topics they discuss are mountains: the more people discuss a topic, the higher it rises.
      <a href="./dashboard.html">Today</a> tells the same story as a front page.</p>
    </section>

    <section id="groups">
      <h2>The six groups</h2>
      <p>Every account belongs to one group: the part of the AI world it mostly speaks from. Groups are regions on
      the map, and each story shows which groups took part.</p>
      ${groups()}
    </section>

    <section id="mood">
      <h2>Mood</h2>
      <p>Claude reads each post and, where the post takes a stance, scores it on two scales. A topic's mood is the
      average of its posts; a group's mood the average of its members' posts. On the map, outlook is a watercolour
      wash, belief is the weight of the ink, and a divided topic's wash splits in two.</p>
      ${axis('outlook', 'worried', 'hopeful')}
      ${axis('belief', 'sceptics', 'believers')}
      ${axis('division', 'agreed', 'divided')}
      <h3 id="mixed">${TERMS.mixed.name}</h3>
      <p>${TERMS.mixed.short}</p>
    </section>

    <section id="measures">
      <h2>How things are measured</h2>
      <ul>
        <li><b>Topics</b> are found by Claude from original posts (no replies or reposts) by the accounts below,
        on X and Bluesky, every hour; links from the other sources are joined to them, or become stories of their
        own when the accounts didn't discuss them.</li>
        <li><b>A topic's size</b> is how many different accounts discussed it, times its engagement (likes,
        reposts, replies and quotes, counting each person's three best posts so one big account can't dominate).</li>
        <li><b>A town's size</b> is the account's standing across platforms: its best rank among accounts on X,
        Bluesky, GitHub, Hugging Face or in citations, plus a little for each other one where it ranks well.</li>
        <li><b>Niche stories</b> are specific discussions (rated by Claude) that still drew real engagement,
        favouring those with a smaller crowd.</li>
      </ul>
    </section>

    <section id="sources">
      <h2>Sources</h2>
      <h3>Accounts</h3>
      <p>${ACCOUNTS.length} accounts${accountMix()}. Groups and matches across platforms are made by Claude
      and checked against links the accounts publish.</p>
      <h3>Posts</h3>
      <ul>
        <li><b>X</b>: every original post by the accounts on X, read through twitterapi.io.</li>
        <li><b>Bluesky</b>: every original post by the accounts on Bluesky; plus the most-liked posts from anyone
        (${BLUESKY_MIN_LIKES}+ likes) mentioning ${BLUESKY_QUERIES.map(esc).join(', ')}.</li>
      </ul>
      <h3>Links and stories</h3>
      <ul>
        <li><b>Hacker News</b>: stories with ${HN_MIN_POINTS}+ points.</li>
        <li><b>Hugging Face Daily Papers</b>: papers with ${PAPERS_MIN_UPVOTES}+ upvotes.</li>
        <li><b>Company blogs</b>: ${feedNames('company')}, Anthropic.</li>
        <li><b>Community blogs and newsletters</b>: ${feedNames('community')}.</li>
        <li><b>News</b>: ${feedNames('news')}.</li>
      </ul>
      <h3>Markets</h3>
      <ul>
        <li><b>Forecasts</b>: open prediction markets about AI on Manifold.</li>
        <li><b>Stocks</b>: the day's change for ${STOCKS.map(([symbol, name]) => `${esc(name)} (${symbol})`).join(', ')}, from Finnhub.</li>
      </ul>
      <h3>Account details</h3>
      <ul>
        <li><b>GitHub</b> and <b>Hugging Face</b>: followers, stars and models, for accounts that link to them.</li>
        <li><b>Papers</b>: citations and h-index from OpenAlex, for researchers we could match to their papers.</li>
      </ul>
    </section>

    <section id="caveats">
      <h2>Things to keep in mind</h2>
      <ul>
        <li>The data covers a short window (${dates}), so it shows what was loud, not what matters most.</li>
        <li>The accounts were chosen by hand and grown from there; they lean English-speaking and US-based.</li>
        <li>Moods and summaries are written by a model and can be wrong. Treat them as rough signals.</li>
        <li>Most posts take no stance, so a mood can rest on only a handful of posts.</li>
      </ul>
    </section>
  </div>
`;

installDefinitions();
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
