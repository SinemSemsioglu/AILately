#!/bin/sh
# The live store (data/raw/live: posts, scores, topics, other sources, run state), kept between hourly runs as
# one archive in Cloudflare R2. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
#
#   scripts/store.sh pull     # R2 → data/raw/live (nothing there yet is fine: the first run starts fresh)
#   scripts/store.sh push     # data/raw/live → R2
set -e
cd "$(dirname "$0")/.."
OBJECT=ai-lately-store/live.tar.gz
case "$1" in
  pull)
    # Only a store that doesn't exist yet means "start fresh"; any other failure stops the run, so a
    # network hiccup can never lead to an empty store being pushed over the real one.
    mkdir -p data/raw
    if npx wrangler r2 object get "$OBJECT" --remote --file /tmp/live.tar.gz 2> /tmp/r2.err; then
      tar -xzf /tmp/live.tar.gz -C data/raw
      echo "Store pulled ($(du -sh data/raw/live | cut -f1))"
    elif grep -qiE "not found|does not exist|NoSuchKey|10007" /tmp/r2.err; then
      echo "No store in R2 yet; starting fresh"
    else
      cat /tmp/r2.err >&2
      exit 1
    fi
    ;;
  push)
    tar -czf /tmp/live.tar.gz -C data/raw --exclude live/logs --exclude live/run.lock live
    npx wrangler r2 object put "$OBJECT" --remote --file /tmp/live.tar.gz
    echo "Store pushed ($(du -sh /tmp/live.tar.gz | cut -f1))"
    ;;
  *)
    echo "Usage: scripts/store.sh pull|push" >&2
    exit 1
    ;;
esac
