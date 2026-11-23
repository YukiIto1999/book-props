#!/usr/bin/env bash
set -euo pipefail

: "${DEFAULT_BRANCH:?}" "${GITHUB_EVENT_NAME:?}" "${GITHUB_REF:?}" "${GITHUB_SHA:?}" "${GITHUB_OUTPUT:?}"
commit=$(git rev-parse HEAD)
test "$commit" = "$(git rev-parse "$GITHUB_SHA^{commit}")"
git merge-base --is-ancestor "$commit" "refs/remotes/origin/$DEFAULT_BRANCH"
version=$(jq -er '.version' package.json)
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
for manifest in runtimes/obsidian/manifest.json runtimes/book-extension/manifest.json; do
  jq -e --arg version "$version" '.version == $version' "$manifest" > /dev/null
done

tag="v$version"
candidate_ref="refs/heads/$DEFAULT_BRANCH"
case "$GITHUB_EVENT_NAME" in
  workflow_dispatch)
    test "$GITHUB_REF" = "$candidate_ref"
    ;;
  push)
    test "$GITHUB_REF" = "refs/tags/$tag"
    tag_object=$(git rev-parse --verify "$GITHUB_REF^{tag}")
    test "$commit" = "$(git rev-parse "$tag_object^{commit}")"
    annotation=$(git for-each-ref --count=1 --format='%(contents:subject)' "$GITHUB_REF")
    if ! [[ "$annotation" =~ ^book-props-release:\ ([1-9][0-9]*)/([1-9][0-9]*)\ ([0-9a-f]{64})$ ]]; then
      printf 'Use the book-props-release annotation from the accepted candidate run.\n' >&2
      exit 1
    fi
    test -s tools/release/cosign.pub || { printf 'Commit tools/release/cosign.pub before building the candidate.\n' >&2; exit 1; }
    printf 'tag_object=%s\ncandidate_run=%s\ncandidate_attempt=%s\ncandidate_hash=%s\n' \
      "$tag_object" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" >> "$GITHUB_OUTPUT"
    ;;
  *) exit 1 ;;
esac
printf 'tag=%s\ncommit=%s\ncandidate_ref=%s\n' "$tag" "$commit" "$candidate_ref" >> "$GITHUB_OUTPUT"
