# shellcheck shell=bash
# Shared by every target. Sourced inside the container by entrypoint.sh,
# never run on its own.
#
# The layout is the same for every target and on every machine:
#   /src    the two source trees as `git archive` files, read-only
#   /build  where they are unpacked and compiled; wiped at every start
#   /cache  downloads only, each one checked against a hash on the way in;
#           read-only in the build phase, which checks again what it uses
#   /out    the artefacts, SHA256SUMS and build-info/

WORK=/build
CACHE=/cache
OUT=/out
APP="$WORK/gerfaut-desktop"

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# Everything a tool could otherwise pick up from its surroundings.
# repro_env <fetch|build>
repro_env() {
    local phase="$1"
    [ -n "${SOURCE_DATE_EPOCH:-}" ] || die "SOURCE_DATE_EPOCH is not set"
    export SOURCE_DATE_EPOCH
    export TZ=UTC LANG=C LC_ALL=C
    umask 022

    # A home of its own, so no tool finds a configuration file or a cache
    # the recipe did not put there.
    export HOME="$WORK/home"
    export XDG_CACHE_HOME="$HOME/.cache"
    export XDG_CONFIG_HOME="$HOME/.config"
    export XDG_DATA_HOME="$HOME/.local/share"

    # The cache volume outlives the container and other builds write to
    # it, and Cargo trusts whatever it finds in its home: a configuration
    # file, an unpacked crate, a .crate file it did not download itself.
    # So the fetch phase keeps only downloads there, and the build phase
    # has a home of its own, filled by seed_cargo_home.
    if [ "$phase" = build ]; then
        export CARGO_HOME="$WORK/cargo"
    else
        export CARGO_HOME="$CACHE/cargo"
    fi
    export CARGO_INCREMENTAL=0
    export CARGO_TERM_COLOR=never
    [ -z "${GERFAUT_JOBS:-}" ] || export CARGO_BUILD_JOBS="$GERFAUT_JOBS"

    # The build path is fixed, so these flags do not decide whether two
    # builds match. They keep the container's layout out of the binary:
    # the only absolute paths left in it start with /gerfaut, /cargo or
    # /rustup. When two prefixes match, the later flag wins, so the Cargo
    # home under /build still becomes /cargo. The separator is the one
    # Cargo expects in this variable.
    local us=$'\x1f'
    export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=${WORK}=/gerfaut${us}--remap-path-prefix=${CARGO_HOME}=/cargo${us}--remap-path-prefix=${RUSTUP_HOME}=/rustup"
    # The same for the C code some crates compile (SQLite, zstd, ring).
    local maps="-ffile-prefix-map=${WORK}=/gerfaut -ffile-prefix-map=${CARGO_HOME}=/cargo"
    export CFLAGS="$maps" CXXFLAGS="$maps"

    # npm checks every tarball against package-lock.json each time it
    # reads the cache, so the build phase reads it where it is.
    export npm_config_cache="$CACHE/npm"
    export npm_config_logs_dir="$HOME/.npm-logs"
    export npm_config_update_notifier=false
    export npm_config_fund=false
    export npm_config_audit=false
    export CI=true
}

# The image's entry point has already unpacked both trees under /build,
# a path that is the same on every machine. The desktop crate finds the
# core through ../../gerfaut-core.
prepare_dirs() {
    local dir
    for dir in gerfaut-desktop gerfaut-core; do
        [ -d "$WORK/$dir" ] || die "missing source tree: $WORK/$dir"
    done
    mkdir -p "$HOME" "$OUT"
}

# rust-toolchain.toml names the compiler. The image must already hold it:
# a build that has to download a toolchain is not the pinned build.
check_toolchain() {
    local want have
    want="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$APP/rust-toolchain.toml")"
    have="$(cd / && rustc --version | cut -d' ' -f2)"
    [ "$want" = "$have" ] || die "rust-toolchain.toml asks for $want, the image holds $have: rebuild the image"
    log "rustc $have, cargo $(cd / && cargo --version | cut -d' ' -f2), node $(node --version), npm $(npm --version)"
}

app_version() {
    sed -n 's/^  "version": *"\(.*\)",$/\1/p' "$APP/src-tauri/tauri.conf.json"
}

# --- network phase -------------------------------------------------------

# Fills the npm cache. package-lock.json carries the hash of every
# tarball and npm checks each one, now and again when it reads the cache.
fetch_npm() {
    log "npm: filling the cache"
    (cd "$APP" && npm ci --ignore-scripts --no-progress > /dev/null)
    rm -rf "$APP/node_modules"
}

# Only downloads stay in the volume: the registry index, the .crate files
# and the git database. Anything else an earlier run left there, a
# configuration file, an installed binary, an unpacked source, is removed
# before Cargo starts.
prune_cargo_cache() {
    local dir="$CACHE/cargo"
    mkdir -p "$dir/registry" "$dir/git"
    find "$dir" -mindepth 1 -maxdepth 1 ! -name registry ! -name git -exec rm -rf {} +
    find "$dir/registry" -mindepth 1 -maxdepth 1 ! -name index ! -name cache -exec rm -rf {} +
    find "$dir/git" -mindepth 1 -maxdepth 1 ! -name db -exec rm -rf {} +
}

# Fills the cargo registry for the given target triples. Cargo.lock
# carries the hash of every crate and the revision of the one git source.
fetch_cargo() {
    local args=() triple
    for triple in "$@"; do args+=(--target "$triple"); done
    log "cargo: fetching for $*"
    (cd "$APP/src-tauri" && cargo fetch --locked "${args[@]}")
}

# fetch_pinned <sha256sum file> <name> <url>: downloads into
# /cache/tools/<name> unless a copy with the right hash is already there.
fetch_pinned() {
    local sums="$1" name="$2" url="$3" want
    want="$(awk -v n="$name" '!/^#/ && $2 == n { print $1 }' "$sums")"
    [ -n "$want" ] || die "$name is not listed in $sums"
    mkdir -p "$CACHE/tools"
    if ! echo "$want  $CACHE/tools/$name" | sha256sum --check --status 2> /dev/null; then
        log "fetching $name"
        curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --retry 3 \
            --output "$CACHE/tools/$name.part" "$url"
        echo "$want  $CACHE/tools/$name.part" | sha256sum --check --status \
            || die "$name does not match the hash in $sums"
        mv "$CACHE/tools/$name.part" "$CACHE/tools/$name"
    fi
}

# --- offline phase -------------------------------------------------------

# use_pinned <sha256sum file> <name> <destination>: copies a tool out of
# the cache and checks the copy. The cache is a volume that outlives the
# container, and the check is cheap.
use_pinned() {
    local sums="$1" name="$2" dest="$3" want
    want="$(awk -v n="$name" '!/^#/ && $2 == n { print $1 }' "$sums")"
    [ -n "$want" ] || die "$name is not listed in $sums"
    mkdir -p "$(dirname "$dest")"
    cp "$CACHE/tools/$name" "$dest"
    echo "$want  $dest" | sha256sum --check --status \
        || die "$name in the cache does not match $sums: run the fetch phase again"
}

# The Cargo home of the build phase, filled from the cache. Cargo uses a
# .crate file it finds in its cache without checking it, so each one is
# copied, then checked against the checksum Cargo.lock gives for it. A
# file Cargo.lock does not name is left behind. The index and the git
# database come as they are: Cargo.lock fixes every version, and a git
# object is named after its own hash.
seed_cargo_home() {
    local from="$CACHE/cargo" lock="$APP/src-tauri/Cargo.lock" sums="$WORK/crates.sha256"
    local registry name
    log "cargo: checking the cached crates against Cargo.lock"
    [ -d "$from/registry/cache" ] || die "no crates in the cache: run the fetch phase again"
    mkdir -p "$CARGO_HOME/registry/cache" "$CARGO_HOME/git"
    cp -r "$from/registry/index" "$CARGO_HOME/registry/"
    [ ! -d "$from/git/db" ] || cp -r "$from/git/db" "$CARGO_HOME/git/"
    awk '/^\[\[package\]\]$/ { name = ""; version = "" }
         /^name = /     { gsub(/"/, "", $3); name = $3 }
         /^version = /  { gsub(/"/, "", $3); version = $3 }
         /^checksum = / { gsub(/"/, "", $3); print $3 "  " name "-" version ".crate" }' "$lock" > "$sums"
    for registry in "$from"/registry/cache/*/; do
        registry="$(basename "$registry")"
        mkdir -p "$CARGO_HOME/registry/cache/$registry"
        while read -r _ name; do
            [ ! -f "$from/registry/cache/$registry/$name" ] \
                || cp "$from/registry/cache/$registry/$name" "$CARGO_HOME/registry/cache/$registry/"
        done < "$sums"
        (cd "$CARGO_HOME/registry/cache/$registry" && sha256sum --check --quiet --strict --ignore-missing "$sums") \
            || die "a cached crate does not match Cargo.lock: run the fetch phase again"
    done
    rm "$sums"
}

# The frontend is the same for every target. Vite names its chunks after
# a hash of their content and writes no sourcemap, so two builds give the
# same files; build-info/frontend.sha256 is there to show it.
build_frontend() {
    log "frontend: npm ci, tsc, vite build"
    (
        cd "$APP" || exit 1
        npm ci --offline --no-progress
        npm run build
    )
    mkdir -p "$OUT/build-info"
    (cd "$APP/dist" && find . -type f -print0 | sort -z | xargs -0 sha256sum) \
        > "$OUT/build-info/frontend.sha256"
}

# tauri_build <args>: compiles the application through the Tauri CLI, so
# the features, the environment and the embedded assets are the ones a
# plain `npm run tauri build` would use. The frontend is already built.
tauri_build() {
    (
        cd "$APP" || exit 1
        npm run tauri -- build --ci \
            --config '{"build":{"beforeBuildCommand":""}}' "$@" -- --locked --offline
    )
}

# Which commits the artefacts were built from. A build against a core
# other than the pinned one is allowed for development, and it must not
# be mistaken for a release build afterwards: the file says so, and
# compare.py reads it.
write_sources() {
    {
        echo "gerfaut-desktop ${GERFAUT_DESKTOP_REV:-unknown}"
        echo "gerfaut-core ${GERFAUT_CORE_REV:-unknown}"
        if [ "${GERFAUT_CORE_REV:-}" != "${GERFAUT_CORE_PINNED:-}" ]; then
            echo "gerfaut-core-pinned ${GERFAUT_CORE_PINNED:-unknown}"
            echo "NOT A RELEASE BUILD: the core is not the pinned revision"
        fi
    } > "$OUT/build-info/sources"
    cat "$OUT/build-info/sources"
}

# Every artefact at the top of /out, sorted by name.
write_sums() {
    local sums
    sums="$(cd "$OUT" && find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%P\0' \
        | sort -z | xargs -0 sha256sum)"
    printf '%s\n' "$sums" > "$OUT/SHA256SUMS"
    cat "$OUT/SHA256SUMS"
}

# Leave the output owned by whoever owns the mount, not by root.
fix_owner() {
    local owner
    owner="$(stat -c '%u:%g' "$OUT")"
    [ "$owner" = "0:0" ] || chown -R "$owner" "$OUT"
}
