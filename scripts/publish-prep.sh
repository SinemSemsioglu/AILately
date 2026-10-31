#!/bin/sh
# Prepare the public copy of the repo: today's tracked files in a fresh repository with a single commit (so
# older commits, and anything they mention, stay private), after checking nothing private comes along.
#
#   scripts/publish-prep.sh <github-remote-url>     # e.g. https://github.com/<you>/ai-lately.git
#
# Creates ../ai-lately-public; push it with: git -C ../ai-lately-public push -u origin main
set -e
cd "$(dirname "$0")/.."
REMOTE="$1"
OUT=../ai-lately-public
[ -n "$REMOTE" ] || { echo "Usage: scripts/publish-prep.sh <github-remote-url>" >&2; exit 1; }
[ ! -e "$OUT" ] || { echo "$OUT already exists" >&2; exit 1; }

mkdir "$OUT"
git archive HEAD | tar -x -C "$OUT"

# Checks: no data/raw, no .env, no keys, no private dataset names (PRIVATE_NAMES, comma-separated).
fail=0
[ ! -e "$OUT/data/raw" ] || { echo "data/raw is in the copy" >&2; fail=1; }
[ ! -e "$OUT/.env" ] || { echo ".env is in the copy" >&2; fail=1; }
if grep -rIlE "(sk-ant-|ghp_|github_pat_|AAAAAAAAAAAAAAAAAAAAA)[A-Za-z0-9_%-]{10,}" "$OUT" > /tmp/keys.txt; then
  echo "Possible keys in:" >&2; cat /tmp/keys.txt >&2; fail=1
fi
for name in $(echo "${PRIVATE_NAMES:-}" | tr ',' ' '); do
  if grep -rIli "$name" "$OUT" > /tmp/names.txt; then echo "'$name' appears in:" >&2; cat /tmp/names.txt >&2; fail=1; fi
done
[ "$fail" = 0 ] || { rm -rf "$OUT"; echo "Not prepared." >&2; exit 1; }

git -C "$OUT" init -q -b main
git -C "$OUT" add -A
git -C "$OUT" -c user.name=Sinem -c user.email=sinem93@gmail.com commit -q -m "AI Lately"
git -C "$OUT" remote add origin "$REMOTE"
echo "Ready: $OUT ($(git -C "$OUT" ls-files | wc -l | tr -d ' ') files, one commit). Push with: git -C $OUT push -u origin main"
