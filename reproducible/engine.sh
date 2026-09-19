# Shared by the scripts that run on the host (build.sh, compare.sh,
# verify.sh): which container engine, and how to hand it a path.

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

# build_image <Dockerfile stage> <tag> <repository> <commit>: the recipe
# of the commit being built, not the one in the working tree, and the
# compiler rust-toolchain.toml names at that commit.
build_image() {
    local stage="$1" tag="$2" repo="$3" commit="$4" rust
    rust="$(git -C "$repo" show "$commit:rust-toolchain.toml" | sed -n 's/^channel *= *"\(.*\)"/\1/p')"
    git -C "$repo" -c core.autocrlf=false show "$commit:reproducible/Dockerfile" \
        | engine build --target "$stage" --build-arg "RUST_VERSION=$rust" -t "$tag" -
}
