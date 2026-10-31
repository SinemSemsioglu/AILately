# Seed data

`seeds.csv` is the hand-curated starting list of accounts. Edit it freely (any spreadsheet app works).

| column | meaning |
|---|---|
| `handle` | X handle, without `@` |
| `name` | display name (the API fetch will overwrite with the real one) |
| `type` | `person`, `org` or `product` |
| `parent` | handle this account is merged into (e.g. `ChatGPTapp` → `OpenAI`); blank if standalone |
| `region` | conversation community: `frontier`, `research`, `builders`, `creative`, `robotics`, `discourse`, `safety` |
| `subgroup` | finer role / niche, informational |
| `secondary` | a second region the account also belongs to, if any |
| `confidence` | how sure we are the handle is correct: `high`, `medium`, `low` |

**Merging:** an account with a `parent` doesn't get its own peak. The parent is sized by its own
counts only (no summing, so no double-counted followers), and its hover card shows the stats of
both the parent and each merged account.

## Candidates

`candidates.csv` holds accounts proposed for the map but not yet screened. Each row says where it came from (`source`).

- `ai-influencers-x`: accounts from [AI Influencers on X](https://x.mitbunny.ai/) by Arianassskm
  ([repo](https://github.com/Arianassskm/AI_Influencers_X)), data as of February 2026. `in_network_follows` is how many
  of the accounts on that map follow this one; `their_group` is that project's label, kept for reference only.
