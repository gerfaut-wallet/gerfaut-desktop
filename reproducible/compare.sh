#!/usr/bin/env bash
# Compares two directories of artefacts with compare.py, inside the
# pinned image so the host needs no Python and no squashfs tools.
#
#   reproducible/compare.sh build-1 build-2
#   reproducible/compare.sh --published downloads rebuilt
#
# When the two sets differ, it builds the `tools` stage of the Dockerfile
# and runs the comparison again with diffoscope; the reports land in a
# `diffoscope` directory inside the second directory.
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
. "$here/engine.sh"

mode=()
if [ "${1:-}" = "--published" ]; then mode=(--published); shift; fi
[ $# -eq 2 ] || { sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }
first="$(cd "$1" && pwd)"
second="$(cd "$2" && pwd)"

# Both sets are mounted read-only: a published file is hostile until its
# hash says otherwise, and the tools that open it must not be able to
# change the rebuild it is compared with. The diffoscope reports get a
# directory of their own.
# shellcheck disable=SC2086
compare_in() {
    local image="$1"; shift
    engine run --rm --network none --entrypoint python3 \
        -v "$(hostpath "$here/compare.py"):/compare.py:ro" \
        -v "$(hostpath "$first"):/first:ro" \
        -v "$(hostpath "$second"):/second:ro" \
        "$@" \
        ${GERFAUT_RUN_ARGS:-} \
        "$image" /compare.py "${mode[@]}" "${report[@]}" /first /second
}

image="${GERFAUT_COMPARE_IMAGE:-gerfaut-desktop-rb:linux}"
engine image inspect "$image" > /dev/null 2>&1 || build_image linux "$image" "$repo" HEAD

report=()
if compare_in "$image"; then exit 0; fi

echo
echo "==> looking closer with diffoscope"
build_image tools gerfaut-desktop-rb:tools "$repo" HEAD > /dev/null 2>&1 \
    || { echo "could not build the tools image, no diffoscope report" >&2; exit 1; }
mkdir -p "$second/diffoscope"
report=(--diffoscope /report)
compare_in gerfaut-desktop-rb:tools -v "$(hostpath "$second/diffoscope"):/report" > /dev/null 2>&1 || true
echo "==> reports in $second/diffoscope"
exit 1
