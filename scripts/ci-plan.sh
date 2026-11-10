#!/usr/bin/env bash
# Decides whether CI runs the end-to-end suite (the slow part: a Jellyfin server and a browser, ~4 minutes).
# It's skipped only when it can't tell us anything new:
#   1. the change can't affect the app: docs, Markdown, the Dependabot config, the plugin repository manifest, or a
#      release bump that only touches the version lines in Directory.Build.props (plus the changelog);
#   2. a push to main whose code is exactly what a pull request already ran the e2e suite on (rebase merges re-run
#      CI on an identical tree). Two PRs landing back to back produce a combination nobody tested, so that runs.
# Everything else runs it. Prints `e2e=true|false` and `reason=…` for $GITHUB_OUTPUT.
#
# Env: EVENT (pull_request|push), BASE and HEAD (commit range), REPO (owner/name), GH_TOKEN for the API lookups.
set -euo pipefail

decide() {
  echo "e2e=$1"
  echo "reason=$2"
  exit 0
}

zero=0000000000000000000000000000000000000000
[[ -z "${BASE:-}" || "$BASE" == "$zero" ]] && decide true "no base commit to compare with"
git cat-file -e "$BASE^{commit}" 2>/dev/null || decide true "base commit $BASE isn't available"

# Three dots: what this change did since it branched off, not what its base gained since.
files=$(git diff --name-only "$BASE"..."$HEAD")
[[ -z "$files" ]] && decide true "no file changes found"

# 1. Nothing the app is built from.
inert=true
while IFS= read -r f; do
  case "$f" in
    *.md | docs/* | LICENSE | .github/dependabot.yml | manifest.json) ;;
    Directory.Build.props)
      # Only the version lines changed (a release bump).
      changed=$(git diff -U0 "$BASE"..."$HEAD" -- Directory.Build.props | grep -E '^[+-][^+-]' || true)
      if grep -vqE '<(Version|AssemblyVersion|FileVersion)>' <<<"$changed"; then inert=false; fi
      ;;
    *) inert=false ;;
  esac
done <<<"$files"
[[ "$inert" == true ]] && decide false "only docs, the changelog or version numbers changed"

# 2. A push to main that a pull request already tested, byte for byte.
if [[ "${EVENT:-}" == push && -n "${REPO:-}" ]]; then
  pr=$(gh api "repos/$REPO/commits/$HEAD/pulls" --jq '[.[] | select(.merged_at != null)][0] | "\(.number) \(.head.sha)"' 2>/dev/null || true)
  if [[ -n "$pr" && "$pr" != "null null" ]]; then
    number=${pr% *}
    head_sha=${pr#* }
    pr_tree=$(gh api "repos/$REPO/git/commits/$head_sha" --jq .tree.sha 2>/dev/null || true)
    this_tree=$(git rev-parse "$HEAD^{tree}")
    if [[ -n "$pr_tree" && "$pr_tree" == "$this_tree" ]]; then
      # One e2e job per browser: all of them must have passed.
      e2e=$(gh api "repos/$REPO/commits/$head_sha/check-runs" \
        --jq '[.check_runs[] | select(.name | test("e2e")) | .conclusion] | if length > 0 and all(. == "success") then "success" else (map(select(. != "success")) | .[0]) // "none" end' 2>/dev/null || true)
      [[ "$e2e" == success ]] && decide false "PR #$number ran the e2e suite on this exact code"
    fi
  fi
fi

decide true "the change can affect the app"
