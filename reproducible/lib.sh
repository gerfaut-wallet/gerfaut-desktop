# Shared by every target. Sourced inside the container by entrypoint.sh,
# never run on its own.
#
# The layout is the same for every target and on every machine:
#   /src    the two source trees as `git archive` files, read-only
#   /build  where they are unpacked and compiled; wiped at every start
#   /cache  downloads only, each one checked against a hash on the way in
#   /out    the artefacts, SHA256SUMS and build-info/

WORK=/build
CACHE=/cache
OUT=/out
APP="$WORK/gerfaut-desktop"

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# Everything a tool could otherwise pick up from its surroundings.
repro_env() {
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

    export CARGO_HOME="$CACHE/cargo"
    export CARGO_INCREMENTAL=0
    export CARGO_TERM_COLOR=never
    [ -z "${GERFAUT_JOBS:-}" ] || export CARGO_BUILD_JOBS="$GERFAUT_JOBS"

    # The build path is fixed, so these flags do not decide whether two
    # builds match. They keep the container's layout out of the binary:
    # the only absolute paths left in it start with /gerfaut, /cargo or
    # /rustup. The separator is the one Cargo expects in this variable.
    local us=$'\x1f'
    export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=${WORK}=/gerfaut${us}--remap-path-prefix=${CARGO_HOME}=/cargo${us}--remap-path-prefix=${RUSTUP_HOME}=/rustup"
    # The same for the C code some crates compile (SQLite, zstd, ring).
    local maps="-ffile-prefix-map=${WORK}=/gerfaut -ffile-prefix-map=${CARGO_HOME}=/cargo"
    export CFLAGS="$maps" CXXFLAGS="$maps"

    export npm_config_cache="$CACHE/npm"
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
    mkdir -p "$HOME" "$OUT" "$CACHE"
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
# the cache, checking it once more. The cache is a volume that outlives
# the container, and the check is cheap.
use_pinned() {
    local sums="$1" name="$2" dest="$3" want
    want="$(awk -v n="$name" '!/^#/ && $2 == n { print $1 }' "$sums")"
    echo "$want  $CACHE/tools/$name" | sha256sum --check --status \
        || die "$name in the cache does not match $sums: run the fetch phase again"
    mkdir -p "$(dirname "$dest")"
    cp "$CACHE/tools/$name" "$dest"
}

# The frontend is the same for every target. Vite names its chunks after
# a hash of their content and writes no sourcemap, so two builds give the
# same files; build-info/frontend.sha256 is there to show it.
build_frontend() {
    log "frontend: npm ci, tsc, vite build"
    (
        cd "$APP"
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
        cd "$APP"
        npm run tauri -- build --ci \
            --config '{"build":{"beforeBuildCommand":""}}' "$@" -- --locked --offline
    )
}

# Every artefact at the top of /out, sorted by name.
write_sums() {
    (
        cd "$OUT"
        rm -f SHA256SUMS
        find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%P\0' \
            | sort -z | xargs -0 sha256sum > SHA256SUMS
        cat SHA256SUMS
    )
}

# Leave the output owned by whoever owns the mount, not by root.
fix_owner() {
    local owner
    owner="$(stat -c '%u:%g' "$OUT")"
    [ "$owner" = "0:0" ] || chown -R "$owner" "$OUT"
}
