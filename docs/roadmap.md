# AI Lately — ideas, decisions and plans

A running record of what we've discussed, so nothing gets lost in chat. Newest decisions win; parked ideas
are kept on purpose. Prices are as of Oct 2026 and should be re-checked before relying on them.

## Product

Two parts that are merging into one:

1. **The map**: a 3D landscape of AI people and organisations, in three worlds on one shared layout.
   - **Realm** (fantasy map): *who*. Accounts as mountains, sized by reach or output.
   - **Neon City** (cyberpunk): *what*. Trending topics as towers in the district of the group discussing them
     most, with light arcs to the other groups joining in.
   - **Cosmos** (space): *how it feels*. The same topics as nebulae coloured by each topic's mood; the gas in
     each territory shows that group's overall mood.
2. **The "what's new in AI" dashboard**: not just a list. A richer view of the same data plus extras (stocks,
   summaries, launches). Stories merge mentions across sources (one launch = blog + X + HN + Reddit + news).
   Dashboard stories can link into the map ("who's talking about this") and back.

### Open question: worlds vs one consolidated look (2026-10-28)
The user is considering dropping separate worlds for one consolidated look, with optional *holistic* skins
(a skin restyles everything, dashboard included). Claude's recommendation: separate **lens** (people /
topics / mood = data layers on one map) from **skin** (visual theme); one design system shared by map and
dashboard; one base map style (suggested: modern cartographic) that supports all three lenses; skins later
and optional. The current three renderers would become the first skins. Not decided yet.

**Base look: black & white, ink-illustration map** (decided 2026-10-28; first version built in
`src/modes/ink.js`, baseline commit tagged `worlds-v1`). Ideas for the ink map:
- Mood: **watercolour washes** for outlook (warm ochre/rose = hopeful, cool grey-blue = worried, paper =
  neutral); **belief = ink line weight** (believers bold and crisp, sceptics thin, faded, broken);
  **division** = two washes meeting without blending (hard edge) — explained to the user, not yet confirmed.
- Proposed structure (awaiting confirmation): **groups = territories, people/orgs = towns** (dots + names,
  sized by reach, more names appear as you zoom), **topics = mountains** (height = buzz; each rises among
  the towns of the people discussing it, near borders when shared across groups), **mood = weather washes**.
  People / Topics / Mood become toggleable layers. Topics change daily → the landscape changes; fits the
  history slider. Alternative considered: topics as towers/flags on account terrain (too crowded).
- Proximity would suggest a person↔topic relationship (user raised it; fine if it's true). Proposal:
  **slow towns, fast mountains** — towns placed by each account's *long-term* interests (recomputed every
  few weeks, so they drift slowly instead of jumping daily); daily topic mountains rise among the towns of
  today's participants; **hover/select a mountain → ink trails from today's actual participants** (so
  proximity suggests, trails confirm). Layout order: long-term topics → account positions → daily
  mountains. Rejected: accounts moving daily with topics (no stable mental map, jitter in history).
- Done on 2026-10-28: territories sized by data (accounts + topic buzz share → wedge width and coast reach);
  no central lake (each border river rises at its own inland source).
- **Redesign question (user, 2026-10-28): the same topic appears in multiple groups.** Fixed wedges force
  a shared topic into one territory (or the middle). Options:
  - A. Shared topics as **mountain ranges** crossing borders, a peak per group sized by its share (breaks
    when the groups aren't neighbours).
  - B. (recommended) **Geography emerges from the data**: towns and topics laid out together by a force
    layout (people pulled toward their topics); land = where people are (coast = density contour, outlying
    communities become peninsulas/islands); groups become **countries with dashed political borders**
    around their members; rivers become decoration. Old worlds would stay frozen at `worlds-v1`.
- **Option B built (2026-10-28)**: force layout of towns + topics, land = density contour (organic
  coastline), no rivers, dashed group borders (crude so far; alternatives: smoothed lines, stippled
  group tint, or names only), group names at group centres.
- **Using the space below the land (user idea, 2026-10-28)**:
  - 1 (recommended): **floating island with a cut-away underside**, drawn like an engraved geological
    section. **Strata = time** (each layer an earlier week, thickness = activity; long-lived topics are
    seams through the layers; history slider = slicing the island at a past date). **Roots = interactions**
    (mycelium-like ink roots under towns, linking accounts that reply to / quote each other).
  - 2: a small **planet** (land on a sphere; no edges, but no full overview).
  - 3: a free-form **volumetric cloud** (most original, hardest to read).
- Polish: more ridged, hand-drawn mountains (the current ones read as cones); fainter shallow-water marks.

**Dashboard layout: front page** (decided). A lead story, sections in columns (Models, Research, Policy…), a
Money strip (stocks + funding), mood at a glance. Story cards: Claude summary, source badges with counts
(X / HN / Reddit / blog / paper), buzz sparkline, groups involved, "see on map" link. Other layouts
considered: timeline river (stories as bubbles over time in category lanes), mission control (mini map
centre, panels around, hover a story → regions glow), daily briefing (narrative newsletter with chips and
small charts). Parts of these could become modules later.

### Mood (Cosmos)
- **Outlook**, hopeful ↔ worried → colour (warm gold/rose ↔ cold blue/violet).
- **Belief**, believers ↔ sceptics → brightness/energy (white-hot core with flare spikes ↔ dim, dense, cooler).
- **Division**, agreement ↔ split → shape (one cloud ↔ binary pair; each lobe coloured by a camp; camps
  name the groups in them).
- Scored per tweet by Claude, aggregated per topic and per group. No motion encodings.
- After the first real run, check whether belief and outlook correlate strongly; merge them if they do.
- **Parked:** excitement ↔ frustration (would have been motion).
- UI: Mood focus selector (All / Outlook / Belief / Division), legend key, bars + camps on hover.

### Later ideas
- History slider (needs history: X counts endpoint for activity; Social Blade for follower history).
- Visualising interactions between accounts (replies / quotes / mentions).
- Highlighting important tweets.
- Click a region label → fly there and open a per-world styled summary panel (chronicle / news feed / readout).
- Neon City: show a topic's arcs only on hover to cut clutter.
- Zoom-dependent summaries (idea from WizMap).

## Multi-source map (decided direction)

The map should include people and orgs from **X, GitHub, Hugging Face and papers**, merged into one entity
when they're the same person, with per-source details on hover and filters by source.

**Identity resolution**
- Merge automatically only on explicit links: GitHub `twitter_username` / `blog`; Hugging Face profile pages
  embed a `signup` block with the user's X, GitHub, homepage, LinkedIn and Bluesky handles (a great hub); a
  shared website domain for orgs.
- Same-name-only matches are "probable" and need review. Never merge on name alone. (Example: Clem is
  `ClementDelangue` on X, `clem` on HF, `clmnt` on GitHub; HF search for his name returns impostors.)

**Combined score**
- Percentile within each source (among entities on our map), then **best percentile + a small breadth bonus**
  for each other platform where they're also strong. This doesn't penalise single-platform people.
- Keep two lenses across all sources: **Reach** (X followers, GitHub stars/followers, HF likes/downloads,
  citations) and **Output** (posting volume, commits/repos, models/datasets, papers per year).
- Source filters recompute the score (e.g. "GitHub only" → sized by GitHub percentile).
- Hover cards always show raw per-source numbers.
- Keep the map to roughly 800–1,200 entities with an inclusion bar per source.
- Groups become *communities of work*: GitHub-only or paper-only people are placed by what they work on.

**Matching rules (tightened 2026-10-28):** people only on confirmed links (no name-only matches: they
picked impostors like `elonmuskceo`); a Hugging Face profile that only names the X handle also needs
activity (followers+models+datasets+spaces ≥ 25) or a link to the same confirmed GitHub; organisations may
match by exact name on accounts with ≥ 1,000 followers. Result: 228 GitHub, 108 HF confirmed (+ ~20 orgs).

**More identity sources (ideas):** **Bluesky** (many AI researchers moved there; free API; HF profiles
already list Bluesky handles). For papers, **Hugging Face paper pages** are the best bridge: authors claim
papers from their HF accounts, which link to X/GitHub — no name guessing. **OpenAlex** (free, ORCID links)
as an alternative to Semantic Scholar.

**Phasing**: 1) X + GitHub + HF (built: cards show per-source stats and links; towns can be sized by X,
GitHub, HF, All = combined percentile score, or Activity); 2) papers via Semantic Scholar (hardest matching); 3) multi-source stories
in Neon City (completes the merge with the dashboard).

## Plan (agreed 2026-10-28)

1. Gather every source into the same stories (X ✅, GitHub/HF ✅, papers ✅; next: Hacker News, Reddit,
   company blogs, community blogs incl. LessWrong / Alignment Forum, tech news, stocks, prediction markets).
2. **Design critique** of map + front page together: information hierarchy, what to keep / remove /
   hide initially (the user feels we already show too much). Front-page feedback so far: content is good;
   organisation and hierarchy need work; the section grid below the fold feels too boxy.
3. Then the daily pipeline.

**Sources gathered so far (2026-10-28):** `npm run fetch-sources` → Hacker News (Algolia API, 40+ points),
company blogs (OpenAI, Google DeepMind, Google AI, Hugging Face, NVIDIA; Anthropic from its news page;
Meta AI and Microsoft have no working feed), community blogs (LessWrong, Alignment Forum, Simon Willison,
Interconnects, Import AI, Latent Space, One Useful Thing, AI Snake Oil, Gary Marcus), news (TechCrunch,
The Verge; VentureBeat rate-limits), Manifold markets. `npm run merge-sources` (Claude Code) attaches items
to X topics, groups the rest into new stories, drops non-AI items, ties markets to topics.
**Blocked / needs a decision:** Reddit (no longer serves its public JSON/RSS to scripts, and as of
2026-10-29 self-serve API keys aren't available for projects like ours; new apps need Reddit's approval.
Plan: user is applying through Reddit's developer request form; add Bluesky either way (open public API,
many AI researchers post there), or skip Reddit. Don't scrape), stocks (free no-key source Stooq now blocks scripts; options: a free-key
API such as Finnhub / Alpha Vantage / Twelve Data), Polymarket (API didn't respond; retry later).

**Growing the list from people's follows (2026-10-30):** added 301 of a friend's AI-related follows
that weren't on our list (dropped a changelog bot, a feed, two parodies, a meme account and a mostly-politics
account); source 'community-follows' in candidates.csv. Plan for a "your map" feature: Lite first (highlight
a visitor's follows on our live map, ~free, instant; their unseen AI follows can join the list), Full later
(their own island; needs the Claude API, not the subscription; ~$0.30–0.50 a map, cached, capped).

**Niche view (2026-10-30, from a friend's suggestion):** move past generic launch / company news to
specific, hard-to-reach discussions that still carry weight. Claude rates each topic's specificity (0 broad
news … 1 a specific community discussion); niche = specificity ≥ 0.6, engagement in the window's top 80%,
ranked by specificity × engagement × a smaller crowd. Niche topics may have 2 accounts (or one post with
1,000+ engagement); the main view keeps its 3-account minimum. Switch: Top / Niche on the map and front
page (?stories=niche). Ideas: a niche briefing line; more niche topics will show in the 3-day and week views.

**Live pipeline decisions (2026-10-30):**
- Hourly incremental runs (fetch new posts, score them, place new topic phrases into existing topics or new
  ones; full re-cluster once a day; refresh engagement for posts still in the window). Not on page load:
  analysis takes minutes, runs on the user's Claude Code subscription, and would multiply cost per visitor.
- Front page = rolling last 24h. Map = daily by default with a Day / 3 days / Week toggle (sums over the
  stored scored posts; Week appears once a week of data exists). Daily mood needs a minimum number of
  stance-taking posts before it's shown.
- X via twitterapi.io (~$3/month posts + ~$3 engagement refresh). Run on the user's Mac first, then cloud.
- Bluesky: match our accounts to their Bluesky accounts (confirmed links only: stated links on HF /
  websites / bios, domain handles matching their website, name search verified by Claude) and read their
  posts (public API, no account needed; author feeds page fine). Keep keyword search for the wider crowd
  (first page only without an account; hourly windows make that enough).
- Mood: scored for social posts (X, Bluesky; maybe Hacker News comments). Merged by default; headlines can
  show a split ("hopeful on X, worried on Bluesky").
- Map source selector (All / X / Bluesky / …) filters both mountains/moods and towns (accounts present on
  that source).
- GitHub, arXiv / HF papers: contribute topics and accounts (a paper or repo ties its authors to a topic,
  like a post would) but no mood.

**Sources added 2026-10-30:** Bluesky (public search API, no key; only the first page of each search
works without signing in, so ~84 posts with 200+ likes over 9 queries; post text is used only for
merging, the page shows author + link) and Hugging Face Daily Papers (36 papers with 40+ upvotes, all
attached to X topics). fetch-sources now adds to earlier runs' items (feeds forget old posts; a re-run had
dropped TechCrunch / The Verge). Elsewhere stories rank by their best item's percentile within its source.
**Polymarket**: every Polymarket host resets the connection from the user's network (looks like a
regional block, not an outage); not working around it. Manifold stays the only market source.

**Ideas from 2026-10-29:**
- **Topics too general** (e.g. "AI Jobs And Society", "Coding Agents And Tools"): the merge step asks for
  25–40 topics from ~2,000 posts. Option: two levels: broad themes as mountain ranges, specific stories
  (named launches, papers, debates) as peaks; ask for 60–100 stories, each naming a concrete thing.
- **Niche sample from a friend's following list**: X `following` lookup (~$0.01/user) plus 3 days of
  posts; roughly $15–25 for ~1,000 accounts. A test of how the map looks for a different crowd.
- **"Your map" feature**: the map of whoever an account follows. Public following lists need no sign-in
  (our app token reads them); only protected accounts would need Sign in with X. Cost per new map ~$10–30
  on the official API (cached accounts overlap), so it only scales with a cheaper data source.

**Front page, non-textual element (2026-10-30):** sparklines (posts per 6h) were removed: unlabelled,
self-scaled, noisy on 3 days. User liked having something visual there. Ideas: bring back as a labelled
trend over days once the daily pipeline runs ("rising since Tue"); embed the lead story's top post with
X's official embed widget (X renders it, so no republished text).

**Stocks (2026-10-29, done):** Finnhub free plan (`FINNHUB_API_KEY`) gives live quotes only, no history
(candles are paid), so the sidebar shows the day's change for 13 AI stocks, tied to topics by keyword.
Ideas: the daily pipeline stores each day's quote to build history (window change, sparklines); show a
tied stock next to its story (e.g. GOOGL beside Genie 4).
**Belief data range (2026-10-29):** topics −0.23…0.73 (median 0.49, only one below 0); groups 0.36…0.66;
accounts −0.51…0.88. The account set leans toward people who work in AI, so the sceptic end is nearly
empty. Options: rank belief relative to the window on the map; add more sceptic voices to the account list.

**Front page redesign ideas (2026-10-29):** user wants terminology visible (believers, the 6 groups) and
only top stories highlighted, the rest revealed on interaction. Proposed: inline dotted-underline
definitions; a "How to read this" strip; a **Field guide** page (groups with examples, mood axes with
example posts, how things are measured, caveats) linked from map and front page; labelled mood bars.
Hierarchy in 3 levels: headlines (lead + 3–4) → "More" expands a story in place → "All stories" compact
index with section chips (incl. Elsewhere), collapsed to ~8 rows. Slimmer sidebar (mood chart, 3
forecasts; voices move). Directions: A "Edition" (classic front page) / B "Briefing" (A + a 3-sentence
Claude-written lede with linked terms) — recommended B.
User approved inline definitions and the Field guide. Sidebar in B: mood of the day (group rows, click =
filter stories), most divided / hopeful / worried links, 3 forecasts, later a Money box; active voices
move to a People tab in All stories or the map; "coming soon" box dropped.

**Papers follow-up (todo):** name search picked the most-cited namesake for some well-known people
(Fei-Fei Li, François Chollet, Helen Toner, John Carmack, Jim Fan, Shunyu Yao, Jack Morris, Andrew Trask —
the 'no' rows in data/papers-review.csv). Re-search those with several candidates and check each candidate's
papers against the bio, so the real record is found.

Old worlds retired 2026-10-28 (commit 501fd9d; recoverable via tag `worlds-v1`).

## Data sources

### Used or planned
| Source | Use | Access / cost |
|---|---|---|
| X API (pay-per-use) | Accounts, tweets, trending topics, mood | $0.01/user read, $0.005/post read (confirmed by the pilot) |
| GitHub API | People/orgs, stars, followers, X links; rising AI repos | Free with a personal token (5,000 req/h) |
| Hugging Face API + profile pages | People/orgs, models, likes, followers, cross-platform links; trending models/spaces; Daily Papers | Free |
| Semantic Scholar API | Paper authors, citations | Free |
| arXiv API / RSS | New papers (too many; filter with HF Daily Papers or links shared on X/HN) | Free |
| Hacker News (official API + Algolia search) | Stories and discussions | Free |
| Reddit API | r/LocalLLaMA, r/MachineLearning, r/singularity, r/OpenAI, r/ClaudeAI | Needs Reddit's approval for new apps (no self-serve keys as of 2026-10) |
| Bluesky (AT Protocol public API) | Posts from AI researchers who moved off X; a second social source | Free, no key for public reads |
| Company blogs | Launches (OpenAI and Google have RSS; some, possibly Anthropic, need page parsing) | Free |
| Tech news RSS | TechCrunch, The Verge, VentureBeat AI sections (paywalled ones like The Information are out) | Free |
| Stock prices | NVDA, MSFT, GOOGL, META, AMZN, TSM, AMD, AVGO; private labs → funding rounds/valuations instead | Free tiers (Finnhub, Alpha Vantage) |
| AINews by smol.ai | Daily recap of AI Twitter/Reddit/Discord with handles; discovery + sanity check for our summaries; covers Discord for us | Free |
| AI Influencers on X ([site](https://x.mitbunny.ai/), [repo](https://github.com/Arianassskm/AI_Influencers_X)) | 300 accounts + 3,042 follow links (Feb 2026) → 195 candidates; follow links to sanity-check groups | Free; credit them |

### Dashboard extras (not on the map, keep for later)
- **OpenRouter models list**: detects new models the day they appear, with prices (free).
- **LMArena / Artificial Analysis**: model leaderboard changes ("new #1").
- **GitHub rising repos**: via the search API sorted by stars (no official trending API).
- **Polymarket / Manifold**: AI prediction markets (free APIs).
- **Status pages** (OpenAI, Anthropic, …): outages are news too (free).
- **Product Hunt API**: AI launches.
- **Podcasts / YouTube** (Dwarkesh, Latent Space, …) via the YouTube Data API: optional.
- **Funding / deals** (user wants this; part of a "Money" module with stocks): Claude extracts raises
  (company, amount, round, valuation, lead investors) from news RSS (TechCrunch etc.) and company blog
  announcements; **SEC EDGAR Form D filings** (free API) catch US private raises, sometimes before the press;
  X/HN mentions show buzz. Crunchbase / PitchBook / CB Insights / Dealroom are too expensive. Dedupe a raise
  across sources like any other story.
- **Policy**: Federal Register API, EU AI Act news: maybe.

### Considered and rejected (and why)
- **Discord**: bots must be invited per server; reading without one breaks Discord's rules → use AINews.
- **Social listening platforms** (Brandwatch, Meltwater, Talkwalker, Sprinklr, Pulsar): $1k+/month, overkill.
- **Unofficial X scrapers/APIs** (twitterapi.io, SocialData, Apify, twscrape): 10–30× cheaper but break X's
  terms of service; accounts get banned. (Revisited 2026-10-29: twitterapi.io ~$0.15/1k tweets and
  ~$0.18/1k profiles vs X's ~$5/1k posts and $10/1k users, about 30× cheaper. Bans hit twscrape-style tools
  that use your own X accounts; with resellers like twitterapi.io the risks are reliability (they break
  when X changes things) and the terms/legal grey area, not our accounts. Open decision for the user.)
- **SuperMCP / browser-cookie tools** (checked 2026-10-29): closed-source MCP server that reads your Chrome
  cookies and drives a headless browser as you on X/Reddit. Exposes all browser cookies to unaudited code,
  risks the user's own accounts, is sold on evading bot detection, and suits ad-hoc lookups, not bulk fetches.
- **xAI Grok X search**: could summarise themes, but it's a black box; maybe try once to compare.
- **X context annotations / topic tags**: published list frozen in 2022 and returned tags are generic or off
  (e.g. "Technology Business", "Bernie Sanders").
- **X trends endpoint**: not AI-specific.
- **Global X keyword search for discovery**: the pilot showed it's mostly noise (news bots, marketers), and
  relevancy ranking isn't engagement ranking (top results often had 0–5 likes).
- **Following everyone the seeds follow**: about $1,000–1,800 and noisy.
- **Social Blade**: kept in reserve for follower history (history slider), not needed yet.

### X API notes
- Useful endpoints: `search/recent` (7 days, operators `from: to: -is:reply -is:retweet url: lang:
  conversation_id: list:`), `search/all` (archive; check tier), `lists/:id/tweets` (no filters, ~800 latest),
  `tweets/counts` (volume over time, no content; great for history), `users/:id/mentions`,
  `tweets/:id/quote_tweets`, `tweets?ids=` (refresh metrics), filtered stream (real time; not needed).
- `sort_order=relevancy` is opaque and is **not** engagement ranking.
- Search with `expansions=author_id` returned author profiles without user-read charges in the pilot.

## Discovery plan

1. Seeds (`data/seeds.csv`, 438 hand-curated) + candidates (`data/candidates.csv`).
2. **Round 0**: ~20 tweets per seed (replies included), profile each account with Claude, cluster into
   communities, compare with our groups.
3. Expand mainly through **who the seeds reply to, quote and mention** (precise and free once tweets are
   fetched), plus independent sources: GitHub, Hugging Face, AINews, curated X Lists by others, and a narrow
   X probe (tweets linking `arxiv.org` / `huggingface.co` / `github.com`, or specific paper/model names).
4. Screen candidates: minimum followers / account age / original-post ratio → Claude profile → user review.
   Candidates found by both the network and an independent source go to the top.
5. Stop when a round adds few accounts worth keeping.

### Pilot findings (2026-10-28, 15 safety seeds, $0.85)
- Billing matched the assumed rates exactly; author expansions on search were free.
- 65% of tweets are replies, 17% quotes; ~2–3 tweets/day per account including replies.
- Seed mentions surfaced relevant people (davidskrueger, davidmanheim, xriskology).
- Topic search was mostly noise; X topic tags were useless.

## Trending pipeline (planned)
1. Daily: original posts (no replies/retweets) from our accounts via `from:` batches or `list:`.
2. Claude groups tweets into topics (anchored by shared links), names and summarises them.
3. Rank by engagement and by how many distinct accounts discuss a topic; later, spikes vs a baseline.
4. Same pass scores mood per tweet → topic moods, camps, group moods.
5. Output one JSON file per day for the site.

## Costs

**Cheaper Round 0 (~$20, proposed 2026-10-28):** profiles for all 633 accounts (~$6.30; bios + follower
counts → groups and town sizes) + the last ~3 days of *original* posts from everyone via batched `from:`
searches (~2,000 posts, ~$10) + capped buffer. Gives real topics and moods and rough interests; loses
replies (fewer interaction links / roots, weaker discovery). Add targeted extras later (e.g. replies for
the 100 most central accounts, ~$5). Recurring could drop to ~$15/month with a hard cap of ~100 original
posts/day (top per group).
- **One-off**: Round 0 ≈ $48; two expansion rounds ≈ $35.
- **Recurring (lean)**: ≈ $55/month, all X (daily topic fetch capped per group + monthly profile refresh).
  The full version is ≈ $100–200/month depending on volume.
- **Claude**: run through Claude Code on the user's subscription (scheduled routine or local `claude -p`)
  instead of the API, so no extra cost (it uses plan limits).
- Hosting: static site + GitHub Actions, free. Dashboard extras: mostly free.

## Existing projects (references)
- [AI Influencers on X](https://x.mitbunny.ai/): 3D map of 300 AI accounts on X; closest to our idea, X-only.
- [MeMo:KI](https://cais-research.de/en/research/memoki/memoki-twitter-analysis/): research map of AI discourse on Twitter.
- [VIZoSPHERE](https://flowingdata.com/2011/07/25/the-vizosphere): 2011 map of data-vis Twitter grown from seeds.
- [Map of GitHub](https://anvaka.pages.dev/map-of-github/): repos as a map; great presentation reference.
- [Model Atlas](https://github.com/eliahuhorwitz/Model-Atlas): Hugging Face models as a family graph.
- [DataMapPlot arXiv ML map](https://datamapplot.readthedocs.io/en/latest/auto_examples/plot_interactive_arxiv_ml.html):
  searchable topic map of ML papers.
- [WizMap](https://arxiv.org/pdf/2306.09328): zoom-dependent summaries of embedding maps.
