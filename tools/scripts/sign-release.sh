#!/usr/bin/env bash
set -euo pipefail

artifact=${1:?Usage: bash tools/scripts/sign-release.sh ZIP PUBLIC_KEY}
public_key=${2:?Provide the tracked release public key}
: "${COSIGN_PRIVATE_KEY:?The RELEASE_SIGNING_KEY secret is required}"
: "${COSIGN_PASSWORD:?The RELEASE_SIGNING_PASSWORD secret is required}"
: "${GITHUB_SERVER_URL:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_REF:?}" "${GITHUB_WORKFLOW_REF:?}"
: "${APPROVED_COMMIT:?}" "${REVIEWED_HASH:?}" "${GITHUB_RUN_ID:?}" "${BUILD_ATTEMPT:?}"
test -s "$public_key"

repository="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY"
test "$GITHUB_WORKFLOW_REF" = "$GITHUB_REPOSITORY/.github/workflows/release.yml@$GITHUB_REF"
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ && "$BUILD_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
build_invocation="$repository/actions/runs/$GITHUB_RUN_ID/attempts/$BUILD_ATTEMPT"
commit=$(git rev-parse HEAD)
test "$commit" = "$APPROVED_COMMIT"
filename=${artifact##*/}
tag=${filename#book-props-}
tag=${tag%.zip}
test "$filename" = "book-props-$tag.zip"
test "$GITHUB_REF" = "refs/tags/$tag"

sbom="${artifact%.zip}.spdx.json"
zip_hash=$(sha256sum < "$artifact" | cut -d ' ' -f1)
test "$zip_hash" = "$REVIEWED_HASH"
sbom_hash=$(sha256sum < "$sbom" | cut -d ' ' -f1)
cmp "${artifact%/*}/SHA256SUMS" <(printf '%s  %s\n' "$zip_hash" "$filename")

predicate=$(mktemp)
trap 'rm -f -- "$predicate"' EXIT
jq -n \
  --arg repository "$repository" --arg ref "$GITHUB_REF" --arg commit "$commit" \
  --arg invocation "$build_invocation" --arg builder "$GITHUB_SERVER_URL/$GITHUB_WORKFLOW_REF" \
  --arg sbom "${sbom##*/}" --arg sbom_hash "$sbom_hash" \
  '{
    buildDefinition: {
      buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
      externalParameters: {workflow: {repository: $repository, ref: $ref, path: ".github/workflows/release.yml"}},
      resolvedDependencies: [{uri: ("git+" + $repository + "@" + $ref), digest: {gitCommit: $commit}}]
    },
    runDetails: {
      builder: {id: $builder},
      metadata: {invocationId: $invocation},
      byproducts: [{name: $sbom, digest: {sha256: $sbom_hash}}]
    }
  }' > "$predicate"

signature="$artifact.sigstore.json"
provenance="$artifact.intoto.sigstore.json"
signing=(--yes --key env://COSIGN_PRIVATE_KEY --use-signing-config=false --tlog-upload=false)
verification=(--key "$public_key" --insecure-ignore-tlog)
cosign sign-blob "${signing[@]}" --bundle "$signature" "$artifact"
cosign attest-blob "${signing[@]}" --type slsaprovenance1 --predicate "$predicate" --bundle "$provenance" "$artifact"
jq -es 'length == 2 and all(.[]; has("verificationMaterial") and ((.verificationMaterial.tlogEntries // []) | length == 0))' \
  "$signature" "$provenance" > /dev/null
cosign verify-blob "${verification[@]}" --bundle "$signature" "$artifact"
cosign verify-blob-attestation "${verification[@]}" --type slsaprovenance1 --bundle "$provenance" "$artifact"
jq -er '.dsseEnvelope.payload' "$provenance" |
  base64 --decode |
  jq -e --arg zip_hash "$zip_hash" --slurpfile expected "$predicate" '
    .predicateType == "https://slsa.dev/provenance/v1"
    and ([.subject[].digest.sha256] == [$zip_hash])
    and .predicate == $expected[0]
  ' > /dev/null
