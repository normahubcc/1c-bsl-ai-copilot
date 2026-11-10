#!/usr/bin/env bash
# Publish exactly the reviewed, tested package for the checked-out release tag.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ $# -gt 1 || ( "${1:-}" != "" && "${1:-}" != "--check" ) ]]; then
    echo "Usage: ./publish.sh [--check]" >&2
    exit 2
fi

VERSION="$(node -p 'require("./package.json").version')"
NAME="$(node -p 'require("./package.json").name')"
VSIX_FILE="${NAME}-${VERSION}.vsix"
EXPECTED_TAG="v${VERSION}"

if [[ ! -f "$VSIX_FILE" ]]; then
    echo "Missing exact release artifact: $VSIX_FILE" >&2
    exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Tracked source has uncommitted changes. Freeze and review source first." >&2
    exit 1
fi
while IFS= read -r path; do
    if [[ "$path" != *.vsix ]]; then
        echo "Untracked source or artifact present: $path" >&2
        exit 1
    fi
done < <(git ls-files --others --exclude-standard)

if ! git show-ref --verify --quiet "refs/tags/$EXPECTED_TAG" || \
   [[ "$(git rev-list -n 1 "$EXPECTED_TAG")" != "$(git rev-parse HEAD)" ]]; then
    echo "HEAD must be tagged $EXPECTED_TAG." >&2
    exit 1
fi
REMOTE_REFS="$(git ls-remote --tags origin "refs/tags/$EXPECTED_TAG" "refs/tags/$EXPECTED_TAG^{}")"
REMOTE_COMMIT="$(printf '%s\n' "$REMOTE_REFS" | awk -v tag="refs/tags/$EXPECTED_TAG" '
    $2 == tag { base = $1 }
    $2 == tag "^{}" { peeled = $1 }
    END { if (peeled != "") print peeled; else print base }
')"
if [[ "$REMOTE_COMMIT" != "$(git rev-parse HEAD)" ]]; then
    echo "The origin tag $EXPECTED_TAG is missing or points to another commit." >&2
    exit 1
fi

env -u OVSX_PAT -u VSCE_PAT python3 tests/release_qa.py
sha256sum "$VSIX_FILE"
if [[ "${1:-}" == "--check" ]]; then
    echo "Release preflight passed; no registry was changed."
    exit 0
fi

if [[ -z "${OVSX_PAT:-}" || -z "${VSCE_PAT:-}" ]]; then
    echo "Both OVSX_PAT and VSCE_PAT must be available in a secure environment." >&2
    exit 1
fi

# Both CLIs read the token from their environment; secrets never enter argv.
env -u VSCE_PAT npx --yes ovsx@1.3.0 publish "$VSIX_FILE"
env -u OVSX_PAT npx --yes @vscode/vsce@2.24.0 publish --packagePath "$VSIX_FILE"
echo "Registry upload finished for $VSIX_FILE. Verify both listings and installs."
