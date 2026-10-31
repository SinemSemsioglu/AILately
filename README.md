# AI Lately

A landscape of AI Twitter, drawn as a floating ink island: accounts are towns, the topics they discuss
are mountains, and mood shows as watercolour washes. A daily front page ("The Day in AI") tells the same
story as a newspaper.

```
npm install
npm run dev        # map at /, front page at /dashboard.html
```

Useful URL options on the map: `?pin=<topic or account name>` opens its card, `?groups=safety,research`
preselects groups, `?towns=all` also shows accounts that were quiet in the data window.

## Code

- `src/main.js` — renderer, controls, labels, hover / click / detail cards
- `src/modes/ink.js` — the ink island (terrain, mountains, towns, coast lettering, mood washes, strata)
- `src/atlas-layout.js` — where towns and topics go (force layout) and the land's shape
- `src/dashboard.js` — the daily front page
- `src/data/` — the data the site reads (`atlas.json`, built by the scripts below)

## Data pipeline

```
npm run round0               # X: profiles + recent original posts (resumable, budget-capped)
npm run analyze              # Claude Code reads posts: AI or not, topics, mood
npm run classify-candidates  # Claude Code puts candidate accounts into groups
npm run explore-links        # GitHub / Hugging Face matches
npm run explore-papers       # OpenAlex academic records
npm run build-atlas          # packs everything into src/data/atlas.json
```

Ideas, decisions, sources and costs are recorded in `docs/roadmap.md`. The earlier three themed worlds
(Realm, Neon City, Cosmos) were retired; they're in git history (tag `worlds-v1`).

## Live and hosting

`npm run live` is one hourly run: new X and Bluesky posts (`live-fetch`), Claude's reading of them
(`live-score`), topics (`live-topics`), the other sources (`live-sources`), and the Day / 3-day / Week atlases
(`live-build`). Everything it collects is kept in `data/raw/live/` (not in the repo).

Hosted, it runs on GitHub Actions every hour (`.github/workflows/live.yml`): the store is loaded from and saved
to Cloudflare R2 (`scripts/store.sh`), and the site is published to Cloudflare Pages (`npm run deploy`). The
job needs these repository secrets: `TWITTERAPI_IO_KEY`, `FINNHUB_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (from
`claude setup-token`), `CLOUDFLARE_API_TOKEN` (Pages: Edit, Workers R2 Storage: Edit) and
`CLOUDFLARE_ACCOUNT_ID`. The public repository is made with `scripts/publish-prep.sh`, a fresh one-commit copy
checked for keys and private data.
