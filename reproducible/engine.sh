# shellcheck shell=bash
# Shared by the scripts that run on the host (build.sh,
# make-apple-sdk.sh): which container engine, and how to hand it a path.

ENGINE="${GERFAUT_ENGINE:-}"
if [ -z "$ENGINE" ]; then
    for candidate in docker podman; do
        if command -v "$candidate" > /dev/null 2>&1; then ENGINE="$candidate"; break; fi
    done
fi
[ -n "$ENGINE" ] || { echo "docker or podman is required" >&2; exit 1; }

# Git Bash on Windows rewrites anything that looks like a POSIX path, and
# Docker Desktop wants a Windows path for a bind mount.
engine() { MSYS_NO_PATHCONV=1 command "$ENGINE" "$@"; }
hostpath() {
    if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi
}

# apt_image <target> <repository> <commit>: the image of Ubuntu packages
# the Dockerfile of that commit starts the target from, by digest.
apt_image() {
    local target="$1" repo="$2" commit="$3" ref
    ref="$(git -C "$repo" show "$commit:reproducible/Dockerfile" \
        | awk -v stage="apt-$target" '$1 == "FROM" && $3 == "AS" && $4 == stage { print $2 }')"
    [[ "$ref" =~ ^ghcr[.]io/gerfaut-wallet/gerfaut-desktop-apt@sha256:[0-9a-f]{64}$ ]] || {
        echo "reproducible/Dockerfile at $commit pins no single image for apt-$target: $ref" >&2
        return 1
    }
    echo "$ref"
}

# pull_apt_image <target> <repository> <commit>: pulls that image, unless
# the engine already holds it. The engine checks what it pulls against
# the digest.
pull_apt_image() {
    local ref try
    ref="$(apt_image "$@")" || return 1
    if engine image inspect "$ref" > /dev/null 2>&1; then return 0; fi
    for try in 1 2 3; do
        engine pull "$ref" && return 0
        [ "$try" -lt 3 ] || break
        echo "pull: try $try of 3 failed; next in 30 s" >&2
        sleep 30
    done
    cat >&2 <<EOF
could not pull $ref
  - GitHub's registry is down: try again later;
  - the package is not public: \`$ENGINE login ghcr.io\` with a token that
    can read packages;
  - the image is gone: rebuild it with the Apt image workflow, from
    reproducible/apt.Dockerfile, and pin its new digest in a commit.
EOF
    return 1
}

# build_image <Dockerfile stage> <tag> <repository> <commit>: the recipe
# of the commit being built, not the one in the working tree, on the
# Ubuntu packages it pins, and the compiler rust-toolchain.toml names at
# that commit. The stage is the target.
build_image() {
    local stage="$1" tag="$2" repo="$3" commit="$4" rust
    pull_apt_image "$stage" "$repo" "$commit" || return 1
    rust="$(git -C "$repo" show "$commit:rust-toolchain.toml" | sed -n 's/^channel *= *"\(.*\)"/\1/p')"
    git -C "$repo" -c core.autocrlf=false show "$commit:reproducible/Dockerfile" \
        | engine build --target "$stage" --build-arg "GERFAUT_TARGET=$stage" \
            --build-arg "RUST_VERSION=$rust" -t "$tag" -
}
