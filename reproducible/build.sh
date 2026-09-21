#!/usr/bin/env bash
# Builds the Gerfaut desktop artefacts of one target in the pinned
# container.
#
#   reproducible/build.sh linux            build once into reproducible/out/linux
#   reproducible/build.sh linux --twice    build twice and compare the hashes
#   reproducible/build.sh windows --accept-microsoft-license
#   reproducible/build.sh macos --macos-sdk <directory of the Apple SDK tarballs>
#
# The script exports both source trees from git, so the working tree, the
# checkout location and the host toolchain have no say in the result. It
# needs git and docker or podman, nothing else. Read
# docs/REPRODUCIBLE-BUILDS.md before trusting it.
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"

usage() {
    sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    cat <<'USAGE'

Options:
  --core DIR      gerfaut-core checkout (default: ../gerfaut-core)
  --out DIR       output directory (default: reproducible/out/<target>)
  --ref REF       commit to build (default: HEAD)
  --image NAME    image to build and run (default: gerfaut-desktop-rb:<target>)
  --twice         build twice and fail if the artefacts differ
  --skip-image    reuse the image already built
  --no-cache      download everything again instead of reusing the volume
  --any-core      accept a gerfaut-core checkout other than the pinned one
  --jobs N        cap the number of parallel compiler jobs
  --accept-microsoft-license
                  windows only: you have read and you accept the licence of
                  the Microsoft C runtime and Windows SDK, which the build
                  downloads from Microsoft to this machine
                  (https://go.microsoft.com/fwlink/?LinkId=2086102)
  --macos-sdk DIR  macos only: the directory that holds the Apple SDK
                  tarballs you made from Xcode, see
                  docs/REPRODUCIBLE-BUILDS.md; the build refuses a file
                  whose sha256 is not the one in
                  reproducible/macos/apple-sdk.sha256

Environment:
  GERFAUT_ENGINE      docker or podman (default: the first one found)
  GERFAUT_RUN_ARGS    extra arguments for every container the scripts
                      start, for example "--cpus 4"
USAGE
}

target="${1:-}"
case "$target" in
    linux|windows|macos) shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
esac
[ -f "$here/targets/$target.sh" ] || { echo "no recipe for $target yet" >&2; exit 2; }

core="${GERFAUT_CORE_DIR:-$repo/../gerfaut-core}"
out="$here/out/$target"
ref=HEAD
image="gerfaut-desktop-rb:$target"
twice=0
with_image=1
use_cache=1
any_core=0
jobs=""
microsoft_license=""
macos_sdk=""

while [ $# -gt 0 ]; do
    case "$1" in
        --core) core="$2"; shift 2 ;;
        --out) out="$2"; shift 2 ;;
        --ref) ref="$2"; shift 2 ;;
        --image) image="$2"; shift 2 ;;
        --jobs) jobs="$2"; shift 2 ;;
        --twice) twice=1; shift ;;
        --skip-image) with_image=0; shift ;;
        --no-cache) use_cache=0; shift ;;
        --any-core) any_core=1; shift ;;
        --accept-microsoft-license) microsoft_license=1; shift ;;
        --macos-sdk) macos_sdk="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

. "$here/engine.sh"

# The commit being built, and the core revision that commit pins: read
# from git, so neither the working tree nor another checkout of the file
# can name a different one.
commit="$(git -C "$repo" rev-parse "$ref^{commit}")"
pinned="$(git -C "$repo" show "$commit:.github/gerfaut-core.rev" | tr -d ' \t\r\n')"
[[ "$pinned" =~ ^[0-9a-f]{40}$ ]] || {
    echo ".github/gerfaut-core.rev at $commit is not a full commit hash: $pinned" >&2
    exit 1
}
[ -d "$core/.git" ] || [ -f "$core/.git" ] || {
    echo "not a gerfaut-core checkout: $core" >&2
    echo "clone https://github.com/gerfaut-wallet/gerfaut-core next to this repository" >&2
    exit 1
}
if [ "$any_core" -eq 1 ]; then
    core_rev="$(git -C "$core" rev-parse HEAD)"
    echo "warning: building against gerfaut-core $core_rev, this revision pins $pinned" >&2
else
    core_rev="$pinned"
    git -C "$core" cat-file -e "$core_rev^{commit}" 2> /dev/null || {
        echo "gerfaut-core $core_rev is not in $core: fetch it first" >&2
        exit 1
    }
fi

# The Apple SDK is not free software: it only ever comes from whoever
# builds, and only the files the commit being built names are accepted.
# They are mounted read-only into the container that builds, never into
# the one that has the network.
sdk_mount=()
if [ "$target" = macos ]; then
    [ -n "$macos_sdk" ] || { echo "the macOS build needs the Apple SDK: --macos-sdk DIR" >&2; exit 2; }
    [ -d "$macos_sdk" ] || { echo "not a directory: $macos_sdk" >&2; exit 2; }
    macos_sdk="$(cd "$macos_sdk" && pwd)"
    sdk_files=0
    while read -r sdk_want sdk_name; do
        [[ "$sdk_want" =~ ^[0-9a-f]{64}$ ]] && [[ "$sdk_name" =~ ^[A-Za-z0-9._-]+[.]tar$ ]] \
            || { echo "unexpected line in reproducible/macos/apple-sdk.sha256: $sdk_name" >&2; exit 1; }
        [ -f "$macos_sdk/$sdk_name" ] || { echo "$sdk_name is not in $macos_sdk" >&2; exit 1; }
        if command -v sha256sum > /dev/null 2>&1; then
            sdk_have="$(sha256sum < "$macos_sdk/$sdk_name" | cut -d' ' -f1)"
        else
            sdk_have="$(shasum -a 256 < "$macos_sdk/$sdk_name" | cut -d' ' -f1)"
        fi
        [ "$sdk_have" = "$sdk_want" ] || {
            echo "$macos_sdk/$sdk_name is not the file this recipe pins:" >&2
            echo "  its sha256 is   $sdk_have" >&2
            echo "  the build wants $sdk_want" >&2
            exit 1
        }
        sdk_mount+=(-v "$(hostpath "$macos_sdk/$sdk_name"):/sdk/$sdk_name:ro")
        sdk_files=$((sdk_files + 1))
    done < <(git -C "$repo" show "$commit:reproducible/macos/apple-sdk.sha256" | awk '!/^#/ && $2 ~ /[.]tar$/')
    [ "$sdk_files" -gt 0 ] || { echo "no SDK named in reproducible/macos/apple-sdk.sha256 at $commit" >&2; exit 1; }
elif [ -n "$macos_sdk" ]; then
    echo "--macos-sdk only applies to the macos target" >&2
    exit 2
fi

# The commit date of what is being built, not the wall clock.
epoch="$(git -C "$repo" log -1 --format=%ct "$commit")"
[ -z "$(git -C "$repo" status --porcelain)" ] || \
    echo "warning: uncommitted changes are not part of the build ($ref is)" >&2

if [ "$with_image" -eq 1 ]; then
    echo "==> building $image"
    build_image "$target" "$image" "$repo" "$commit"
fi

stage="$(mktemp -d)"
volume=""
cleanup() {
    rm -rf "$stage"
    [ -z "$volume" ] || engine volume rm "$volume" > /dev/null 2>&1 || true
}
trap cleanup EXIT
# Blob bytes, never the working-tree representation, and unpacked only
# inside the container: line endings, file modes and dates come from git
# and from nothing on this machine.
archive() {
    git -C "$1" -c core.autocrlf=false -c core.eol=lf -c tar.umask=0022 \
        archive --format=tar "$2" > "$stage/$3.tar"
}
archive "$repo" "$commit" gerfaut-desktop
archive "$core" "$core_rev" gerfaut-core

# Downloads only, each one checked against a committed hash; the
# artefacts do not depend on it. Keyed on the target, the compiler and
# the Dockerfile of the commit, so a new toolchain never reuses the cache
# of an older one. Not on the image id: some engines give a new id to
# every build of the same recipe, and each run would download everything
# again and leave a volume behind.
recipe="$(git -C "$repo" rev-parse "$commit:reproducible/Dockerfile" | cut -c1-12)"
rust="$(git -C "$repo" show "$commit:rust-toolchain.toml" | sed -n 's/^channel *= *"\(.*\)"/\1/p')"
if [ "$use_cache" -eq 1 ]; then
    cache="gerfaut-desktop-rb-cache-$target-$rust-$recipe"
else
    volume="gerfaut-desktop-rb-cache-$target-$rust-$recipe-$$"
    cache="$volume"
fi

# shellcheck disable=SC2086
run_build() {
    local dest="$1"
    rm -rf "$dest"
    mkdir -p "$dest"
    echo "--> fetch (network, every download checked against a committed hash)"
    engine run --rm \
        -e SOURCE_DATE_EPOCH="$epoch" \
        -e GERFAUT_ACCEPT_MICROSOFT_LICENSE="$microsoft_license" \
        -v "$cache:/cache" \
        -v "$(hostpath "$stage"):/src:ro" \
        ${GERFAUT_RUN_ARGS:-} \
        "$image" fetch "$target"
    echo "--> build (no network)"
    engine run --rm --network none \
        -e SOURCE_DATE_EPOCH="$epoch" \
        -e GERFAUT_JOBS="$jobs" \
        -e GERFAUT_DESKTOP_REV="$commit" \
        -e GERFAUT_CORE_REV="$core_rev" \
        -e GERFAUT_CORE_PINNED="$pinned" \
        -v "$cache:/cache:ro" \
        -v "$(hostpath "$stage"):/src:ro" \
        -v "$(hostpath "$dest"):/out" \
        "${sdk_mount[@]}" \
        ${GERFAUT_RUN_ARGS:-} \
        "$image" build "$target"
}

echo "==> gerfaut-desktop $commit, gerfaut-core $core_rev"
mkdir -p "$out"
if [ "$twice" -eq 0 ]; then
    run_build "$out"
    echo
    echo "==> artefacts in $out"
    exit 0
fi

echo "==> build 1 of 2"
run_build "$out/build-1"
echo "==> build 2 of 2"
run_build "$out/build-2"

echo
# compare.py runs in the image that has just built, so a Windows build
# does not pull in the Linux image for a comparison.
if GERFAUT_COMPARE_IMAGE="${GERFAUT_COMPARE_IMAGE:-$image}" "$here/compare.sh" "$out/build-1" "$out/build-2"; then
    echo "==> reproducible: both builds produced the same artefacts"
else
    echo "==> NOT reproducible: the two builds differ" >&2
    exit 1
fi
