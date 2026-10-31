#!/bin/zsh
# One live pipeline run, for the hourly schedule (scripts/launchd/): skips if the previous run is still going,
# and logs to data/raw/live/logs/<date>.log.
cd "${0:A:h}/.."
export PATH="$HOME/.local/share/mise/installs/node/24.19.0/bin:$HOME/.local/share/mise/shims:$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin"
mkdir -p data/raw/live/logs
LOG="data/raw/live/logs/$(date +%Y-%m-%d).log"
LOCK=data/raw/live/run.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') previous run still going, skipped" >> "$LOG"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT
echo "=== $(date '+%F %T')" >> "$LOG"
npm run live >> "$LOG" 2>&1
echo "=== done $(date '+%F %T') (exit $?)" >> "$LOG"
