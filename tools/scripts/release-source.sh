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
case "$GITHUB_EVENT_NAME" in
  workflow_dispatch)
    test "$GITHUB_REF" = "refs/heads/$DEFAULT_BRANCH"
    ;;
  push)
    test "$GITHUB_REF" = "refs/tags/$tag"
    tag_object=$(git rev-parse --verify "$GITHUB_REF^{tag}")
    test "$commit" = "$(git rev-parse "$tag_object^{commit}")"
    printf 'tag_object=%s\n' "$tag_object" >> "$GITHUB_OUTPUT"
    ;;
  *) exit 1 ;;
esac
printf 'tag=%s\ncommit=%s\n' "$tag" "$commit" >> "$GITHUB_OUTPUT"
