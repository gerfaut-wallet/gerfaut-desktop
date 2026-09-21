#!/usr/bin/env bash
# What the container runs once the image has unpacked the sources:
# entrypoint.sh <fetch|build> <target>.
#
# Two phases, in two containers. `fetch` has the network and downloads
# what the build needs into /cache, every file checked against a hash
# committed in this repository (package-lock.json, Cargo.lock, the pinned
# tool lists). `build` runs with no network at all, so nothing can reach
# an artefact without having gone through one of those checks.
#
# Run it through reproducible/build.sh rather than by hand.
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/lib.sh"

phase="${1:-}"
target="${2:-}"
case "$target" in
    linux|windows|macos) ;;
    *) die "usage: entrypoint.sh <fetch|build> <linux|windows|macos>" ;;
esac
[ -f "$here/targets/$target.sh" ] || die "no recipe for $target in this revision"
# Defines target_fetch and target_build.
# shellcheck source=targets/linux.sh
. "$here/targets/$target.sh"

repro_env
prepare_dirs
check_toolchain

case "$phase" in
    fetch)
        fetch_npm
        target_fetch
        ;;
    build)
        log "$target, version $(app_version), SOURCE_DATE_EPOCH $SOURCE_DATE_EPOCH"
        find "$OUT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
        mkdir -p "$OUT/build-info"
        cp /etc/gerfaut-image-packages "$OUT/build-info/image-packages"
        write_sources
        build_frontend
        target_build
        write_sums
        fix_owner
        ;;
    *)
        die "unknown phase: $phase"
        ;;
esac
