#!/usr/bin/env bash
# Rebuilds a published release from its tag and compares the result, byte
# for byte, with the files on the releases page.
#
#   reproducible/verify.sh v0.1.0
#
# It clones both repositories at the tag into a fresh directory, builds
# with the recipe of that tag, downloads the published files and prints a
# verdict. It needs git, curl and docker or podman. Read
# docs/REPRODUCIBLE-BUILDS.md before trusting it.
set -euo pipefail

usage() {
    sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    cat <<'USAGE'

Options:
  --target NAME       what to rebuild (default: linux)
  --work DIR          where to clone and build (default: a new temporary directory)
  --published DIR     compare with the files in DIR instead of downloading them
  --desktop-url URL   clone gerfaut-desktop from URL
  --core-url URL      clone gerfaut-core from URL
  --jobs N            cap the number of parallel compiler jobs
USAGE
}

tag=""
target=linux
work=""
published=""
desktop_url=https://github.com/gerfaut-wallet/gerfaut-desktop
core_url=https://github.com/gerfaut-wallet/gerfaut-core
release_url=https://github.com/gerfaut-wallet/gerfaut-desktop/releases/download
jobs=()

while [ $# -gt 0 ]; do
    case "$1" in
        --target) target="$2"; shift 2 ;;
        --work) work="$2"; shift 2 ;;
        --published) published="$2"; shift 2 ;;
        --desktop-url) desktop_url="$2"; shift 2 ;;
        --core-url) core_url="$2"; shift 2 ;;
        --jobs) jobs=(--jobs "$2"); shift 2 ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
        *) [ -z "$tag" ] || { usage >&2; exit 2; }; tag="$1"; shift ;;
    esac
done
[ -n "$tag" ] || { usage >&2; exit 2; }

[ -n "$work" ] || work="$(mktemp -d)"
mkdir -p "$work"
work="$(cd "$work" && pwd)"
echo "==> working in $work"

# A fresh clone at the tag: the recipe that runs is the one the tag
# carries, not the one this script sits next to.
git -c advice.detachedHead=false clone --quiet --branch "$tag" "$desktop_url" "$work/gerfaut-desktop"
core_rev="$(tr -d ' \t\r\n' < "$work/gerfaut-desktop/.github/gerfaut-core.rev")"
echo "==> $tag pins gerfaut-core $core_rev"
git clone --quiet "$core_url" "$work/gerfaut-core"
git -C "$work/gerfaut-core" -c advice.detachedHead=false checkout --quiet "$core_rev"

"$work/gerfaut-desktop/reproducible/build.sh" "$target" \
    --core "$work/gerfaut-core" --out "$work/rebuilt" "${jobs[@]}"

if [ -z "$published" ]; then
    published="$work/published"
    mkdir -p "$published"
    echo "==> downloading the published files"
    # The names come from the rebuild, the bytes from the releases page.
    while read -r _ name; do
        name="${name#\*}"
        curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --retry 3 \
            --output "$published/$name" "$release_url/$tag/$name" \
            || { echo "could not download $name from the $tag release" >&2; exit 1; }
    done < "$work/rebuilt/SHA256SUMS"
fi

echo
echo "==> published release against the rebuild"
if "$work/gerfaut-desktop/reproducible/compare.sh" --published "$published" "$work/rebuilt"; then
    echo "==> VERIFIED: the published $target files of $tag are the ones this source builds"
else
    echo "==> NOT VERIFIED: at least one published file differs from the rebuild" >&2
    echo "    the rebuild and the reports are in $work/rebuilt" >&2
    exit 1
fi
