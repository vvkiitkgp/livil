#!/usr/bin/env bash
# ============================================================================
# schema-parity — does production enforce what this repository declares?
# ============================================================================
#
# WHY THIS EXISTS
#
# CI proves migrations are CORRECT. Nothing proved they were INSTALLED. On 2026-07-22
# the LIV-10 authorization fix sat merged-and-unapplied while the repository, the PR,
# and every generated knowledge-base document read as fixed (D-55). This is the check
# that would have gone red.
#
# HOW IT IS MEANT TO FAIL
#
# Parity is FALSE BY DEFINITION between merging a migration and applying it. So this is
# deliberately NOT a pre-merge gate on its own PR — it would block every migration PR by
# construction. It runs on push to main and on a schedule: main goes red the moment
# something merges unapplied, and stays red until someone applies it.
#
# WHAT A FAILURE MEANS, in order of likelihood:
#   1. A migration merged and was never applied.        -> apply it
#   2. Something was changed in production by hand.     -> write the migration for it
#   3. The fingerprint itself needs adjusting.          -> the least likely; be suspicious
#      of yourself if you reach for this one first.
#
# Usage:  PRODUCTION_DATABASE_URL=... EPHEMERAL_DATABASE_URL=... scripts/schema-parity.sh
# ============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FINGERPRINT="$HERE/schema-fingerprint.sql"
OUT="${RUNNER_TEMP:-/tmp}"

: "${EPHEMERAL_DATABASE_URL:?EPHEMERAL_DATABASE_URL is required (the post-replay database)}"

if [ -z "${PRODUCTION_DATABASE_URL:-}" ]; then
  # Fail loudly rather than skipping. A parity check that silently no-ops when its
  # credential is missing reports success on a comparison it never made — which is the
  # exact failure class this job exists to catch, reproduced inside the fix for it.
  echo "::error::PRODUCTION_DATABASE_URL is not set. This job cannot verify parity without it."
  echo "If the secret was rotated or removed, restore it. Do not disable this job to get green."
  exit 1
fi

# -A unaligned, -t tuples-only: without both, psql adds column padding and a row count,
# and every line differs for reasons that have nothing to do with the schema.
psql "$EPHEMERAL_DATABASE_URL"  -At -v ON_ERROR_STOP=1 -f "$FINGERPRINT" > "$OUT/manifest.repo" || exit 2
psql "$PRODUCTION_DATABASE_URL" -At -v ON_ERROR_STOP=1 -f "$FINGERPRINT" > "$OUT/manifest.prod" || exit 2

echo "repo declares:   $(wc -l < "$OUT/manifest.repo" | tr -d ' ') objects"
echo "production has:  $(wc -l < "$OUT/manifest.prod" | tr -d ' ') objects"
echo

if diff -u "$OUT/manifest.repo" "$OUT/manifest.prod" > "$OUT/parity.diff"; then
  echo "PASS  production enforces exactly what this repository declares."
  exit 0
fi

echo "FAIL  production and this repository disagree about the authorization perimeter."
echo
echo "  '-' = declared in the repo, ABSENT from production (most often: merged, never applied)"
echo "  '+' = present in production, DECLARED NOWHERE (most often: applied by hand)"
echo
sed -n '3,$p' "$OUT/parity.diff"
echo
echo "Counts by object kind:"
for kind in POLICY RLS FUNC TRIGGER; do
  missing=$(grep -c "^-$kind " "$OUT/parity.diff" 2>/dev/null || true)
  extra=$(grep -c "^+$kind " "$OUT/parity.diff" 2>/dev/null || true)
  [ "${missing:-0}" = "0" ] && [ "${extra:-0}" = "0" ] && continue
  echo "  $kind: ${missing:-0} missing from production, ${extra:-0} undeclared in repo"
done
exit 1
