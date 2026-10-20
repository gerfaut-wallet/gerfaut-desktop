# check=skip=InvalidDefaultArgInFrom
# Pinned toolchain the Gerfaut desktop releases are built with.
#
# One file, one stage per target. `base` holds what every target shares:
# the operating system, the compiler and Node. `linux` adds what the
# Linux packages need, `windows` what the cross-built Windows installer
# needs, `macos` what the cross-built macOS application needs.
#
# Everything that can reach an artefact is frozen:
#   - everything that comes from the Ubuntu archive, by the digest of
#     an image of its own per target, below: reproducible/apt.Dockerfile
#     installs a dated snapshot of the archive on a base image pinned by
#     digest, and the Apt image workflow publishes the result on GHCR. A
#     build pulls that image and never talks to the archive;
#   - rustup by the hash of its installer, the Rust toolchain by the hash
#     of its release manifest, which in turn gives the hash of every
#     package it is made of; rustup installs those packages from a local
#     copy checked against it, and downloads nothing itself;
#   - Node by the hash of its tarball.
#
# The image holds the toolchain and nothing else. The recipe that runs in
# it is reproducible/targets/<target>.sh of the very commit being built,
# handed over read-only under /src. Build and run it through
# reproducible/build.sh.

# reproducible/build.sh passes the target here, so that `base` starts
# from the packages of that target and pulls no other image. It has no
# default, on purpose: a build that does not name its target fails here.
ARG GERFAUT_TARGET

# The packages of each target, from the Apt image workflow. These digests
# are the pin, and the only place that names them: an image pushed to
# GHCR changes no build until a reviewed commit writes its digest here.
# To change a package or the snapshot, change reproducible/apt.Dockerfile,
# run the workflow, and paste the lines its summary gives. build.sh reads
# these lines and pulls the image before it builds.
FROM ghcr.io/gerfaut-wallet/gerfaut-desktop-apt@sha256:b2240e949a4d2fd9d665ad5fad77e5ef932d2f100d7044fccaeb33a07a5f1cf1 AS apt-linux
FROM ghcr.io/gerfaut-wallet/gerfaut-desktop-apt@sha256:4f28dfdb721dbd52f6a48618301c8ce0a53cafd6d71353ede9fc121e80cd2603 AS apt-windows
FROM ghcr.io/gerfaut-wallet/gerfaut-desktop-apt@sha256:b3f3fc49827dc641e99f223acd83209c7eac895e146e904304adb86d021fcbb4 AS apt-macos

FROM apt-${GERFAUT_TARGET} AS base

# reproducible/build.sh reads the channel from rust-toolchain.toml and
# passes it here, so the compiler is named in one place only. The
# manifest hash has to follow it:
#   curl -fsSL https://static.rust-lang.org/dist/channel-rust-<version>.toml | sha256sum
ARG RUST_VERSION=1.99.1
ARG RUST_MANIFEST_SHA256=fb152be80975c194aa5fc684b2aec3a6e14e2b855efe2faa4e5f8ae6e590f463
# https://static.rust-lang.org/rustup/archive/<version>/x86_64-unknown-linux-gnu/rustup-init.sha256
ARG RUSTUP_VERSION=1.29.1
ARG RUSTUP_INIT_SHA256=dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71
# The version the workflows install, and its line in
# https://nodejs.org/dist/v<version>/SHASUMS256.txt
ARG NODE_VERSION=24.19.0
ARG NODE_SHA256=14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC \
    LANG=C \
    LC_ALL=C \
    RUSTUP_HOME=/opt/rustup \
    PATH=/opt/cargo/bin:/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

# The Rust toolchain, without letting rustup download it. Left alone,
# rustup fetches the release manifest again after any check made here,
# and trusts whatever it gets the second time. So the manifest is
# fetched once, into /opt/rust-dist, and checked against the hash above.
# `rust-dist <target> <package>...` then fetches each package from the
# address that manifest gives and checks it against the hash it gives,
# and rustup installs from that local copy, through a file:// address.
# Its proxy points at a closed port, so it could not reach the network
# if it tried. The manifest stays in the image for the stages that add
# a target; the packages are deleted once installed.
RUN printf '%s\n' \
      '#!/bin/bash' \
      'set -euo pipefail' \
      'manifest=(/opt/rust-dist/dist/channel-rust-*.toml)' \
      '[ "${#manifest[@]}" -eq 1 ] && [ -f "${manifest[0]}" ] || { echo "rust-dist: no checked manifest" >&2; exit 1; }' \
      'target="$1"' \
      'shift' \
      'for package in "$@"; do' \
      '    url=""; hash=""; inside=0' \
      '    while read -r key _ value; do' \
      '        case "$key" in' \
      '            "[pkg.$package.target.$target]") inside=1 ;;' \
      '            "["*) inside=0 ;;' \
      '            xz_url) [ "$inside" -eq 0 ] || url="${value//\"/}" ;;' \
      '            xz_hash) [ "$inside" -eq 0 ] || hash="${value//\"/}" ;;' \
      '        esac' \
      '    done < "${manifest[0]}"' \
      '    case "$url" in' \
      '        https://static.rust-lang.org/dist/*) ;;' \
      '        *) echo "rust-dist: no $package for $target in the manifest" >&2; exit 1 ;;' \
      '    esac' \
      '    [ "${#hash}" -eq 64 ] || { echo "rust-dist: no hash for $package" >&2; exit 1; }' \
      '    file="/opt/rust-dist/dist/${url#https://static.rust-lang.org/dist/}"' \
      '    mkdir -p "$(dirname "$file")"' \
      '    curl --proto =https --tlsv1.2 --retry 5 -fsSL -o "$file" "$url"' \
      '    echo "$hash  $file" | sha256sum -c -' \
      'done' \
      > /usr/local/bin/rust-dist \
 && chmod 0755 /usr/local/bin/rust-dist \
 && curl --proto '=https' --tlsv1.2 --retry 5 -fsSL -o /tmp/rustup-init \
      "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
 && echo "${RUSTUP_INIT_SHA256}  /tmp/rustup-init" | sha256sum -c - \
 && mkdir -p /opt/rust-dist/dist \
 && curl --proto '=https' --tlsv1.2 --retry 5 -fsSL -o "/opt/rust-dist/dist/channel-rust-${RUST_VERSION}.toml" \
      "https://static.rust-lang.org/dist/channel-rust-${RUST_VERSION}.toml" \
 && echo "${RUST_MANIFEST_SHA256}  /opt/rust-dist/dist/channel-rust-${RUST_VERSION}.toml" | sha256sum -c - \
 && echo "${RUST_MANIFEST_SHA256}  channel-rust-${RUST_VERSION}.toml" \
      > "/opt/rust-dist/dist/channel-rust-${RUST_VERSION}.toml.sha256" \
 && rust-dist x86_64-unknown-linux-gnu rustc rust-std cargo rustfmt-preview clippy-preview \
 && chmod +x /tmp/rustup-init \
 && CARGO_HOME=/opt/cargo RUSTUP_DIST_SERVER=file:///opt/rust-dist \
    all_proxy=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 \
    /tmp/rustup-init -y --no-modify-path --profile minimal \
      --default-toolchain "${RUST_VERSION}" --component rustfmt --component clippy \
 && rm /tmp/rustup-init \
 && find /opt/rust-dist/dist -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} + \
 && rustc --version | grep -qF "rustc ${RUST_VERSION} "

RUN curl --proto '=https' --tlsv1.2 --retry 5 -fsSL -o /tmp/node.tar.xz \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && mkdir /opt/node \
 && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 --no-same-owner \
 && rm /tmp/node.tar.xz \
 && test "$(node --version)" = "v${NODE_VERSION}"

# What the image is made of, for the build log: two images that list the
# same packages build the same artefacts.
RUN dpkg-query -W -f '${Package} ${Version} ${Architecture}\n' | sort > /etc/gerfaut-image-packages

# The sources arrive as two `git archive` files under /src and are
# unpacked here, inside the container, at a path that is the same on
# every machine. File modes and dates then come from git alone: a host
# file system that knows no Unix permissions, or a checkout made last
# week, cannot leak into a package. After that the recipe of the commit
# being built takes over.
RUN printf '%s\n' \
      '#!/bin/bash' \
      'set -euo pipefail' \
      'find /build -mindepth 1 -maxdepth 1 -exec rm -rf {} +' \
      'for tree in gerfaut-desktop gerfaut-core; do' \
      '    mkdir "/build/$tree"' \
      '    tar -xf "/src/$tree.tar" -C "/build/$tree"' \
      'done' \
      'exec bash /build/gerfaut-desktop/reproducible/entrypoint.sh "$@"' \
      > /usr/local/bin/gerfaut-build \
 && chmod 0755 /usr/local/bin/gerfaut-build

WORKDIR /build
ENTRYPOINT ["/usr/local/bin/gerfaut-build"]


# --- Linux packages: .deb, .rpm, .AppImage -------------------------------
FROM base AS linux

# The list README.md gives, plus the packaging tools, all from apt-linux:
# dpkg-deb comes with the base system, rpm brings rpmbuild,
# squashfs-tools writes the AppImage payload, and desktop-file-utils
# checks the desktop entry. A wrong image stops here.
RUN dpkg-query -W libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
      libdbus-1-dev patchelf wget xdg-utils \
      cpio desktop-file-utils rpm squashfs-tools zstd > /dev/null


# --- Windows installer: NSIS setup .exe, cross-built --------------------
FROM base AS windows

# xwin downloads the Microsoft C runtime and the Windows SDK and lays
# them out for a Linux compiler. The image holds the tool, never what it
# downloads: that happens in the fetch phase of each build, on the
# machine of whoever builds, and lands in the cache volume.
#   https://github.com/Jake-Shadle/xwin/releases
ARG XWIN_VERSION=0.10.0
ARG XWIN_SHA256=d870eb4b2f390878af6da1ccd3cf321d22fcb72720984853b4be732ae597fc88
# The installer template of Tauri 2.12 includes Win\RestartManager.nsh,
# a header NSIS added after 3.08, the release this Ubuntu ships. It is
# taken from the NSIS 3.13 tag (zlib licence, like the rest of NSIS's
# headers): defines and macros only, which makensis 3.08 compiles.
#   https://github.com/nsis-dev/nsis/blob/v313/Include/Win/RestartManager.nsh
ARG NSIS_HEADERS_COMMIT=a4ba28e60bd9e7c271cd2bfc1558889ce3355653
ARG RESTART_MANAGER_SHA256=67149978412da9b283e2e1abe48a360093df9caf6363373e2cabe463978b7c0e

# clang-cl compiles the C code some crates carry (SQLite, zstd and
# ring), llvm-lib archives it and llvm-rc compiles the version
# resource. The linker is not in this list: it is the rust-lld of the
# pinned Rust toolchain. makensis comes with its stubs, the head of
# every installer it writes, so the nsis package is pinned like the rest:
# clang-15, llvm-15 and nsis all come from apt-windows.
RUN dpkg-query -W clang-15 llvm-15 nsis > /dev/null \
 && ln -s /usr/lib/llvm-15/bin/clang /usr/local/bin/clang-cl \
 && ln -s /usr/lib/llvm-15/bin/llvm-lib /usr/local/bin/llvm-lib \
 && ln -s /usr/lib/llvm-15/bin/llvm-rc /usr/local/bin/llvm-rc \
 && clang-cl --version | grep -qF 'clang version 15.'

RUN test ! -e /usr/share/nsis/Include/Win/RestartManager.nsh \
 && curl --proto '=https' --tlsv1.2 --retry 5 -fsSL -o /usr/share/nsis/Include/Win/RestartManager.nsh \
      "https://raw.githubusercontent.com/nsis-dev/nsis/${NSIS_HEADERS_COMMIT}/Include/Win/RestartManager.nsh" \
 && echo "${RESTART_MANAGER_SHA256}  /usr/share/nsis/Include/Win/RestartManager.nsh" | sha256sum -c - \
 && chmod 0644 /usr/share/nsis/Include/Win/RestartManager.nsh

# The standard library for Windows, from the same checked manifest as
# the compiler and in the same way: fetched and checked by rust-dist,
# installed by rustup from the local copy.
RUN rust-dist x86_64-pc-windows-msvc rust-std \
 && CARGO_HOME=/opt/cargo RUSTUP_DIST_SERVER=file:///opt/rust-dist \
    all_proxy=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 \
    rustup target add x86_64-pc-windows-msvc \
 && find /opt/rust-dist/dist -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} + \
 && test -d "$(rustc --print target-libdir --target x86_64-pc-windows-msvc)"

RUN curl --proto '=https' --tlsv1.2 --retry 5 -fsSL -o /tmp/xwin.tar.gz \
      "https://github.com/Jake-Shadle/xwin/releases/download/${XWIN_VERSION}/xwin-${XWIN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
 && echo "${XWIN_SHA256}  /tmp/xwin.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/xwin.tar.gz -C /usr/local/bin --strip-components=1 --no-same-owner \
      "xwin-${XWIN_VERSION}-x86_64-unknown-linux-musl/xwin" \
 && rm /tmp/xwin.tar.gz \
 && xwin --version | grep -qF "${XWIN_VERSION}"


# --- macOS application: Gerfaut.app in a zip, cross-built ---------------
FROM base AS macos

# The Apple SDK is not in this image and never will be: build.sh mounts
# the copy of whoever builds, read-only, into the build container only.
#
# clang compiles the C and Objective-C code some crates carry, llvm-ar
# archives it, llvm-lipo joins the two slices of the universal binary
# and llvm-objdump reads them back for the checks of the recipe. They
# come from the official LLVM release, the same major version as the
# LLVM inside rustc, and nothing else of the 1.9 GB archive is kept.
#   https://github.com/llvm/llvm-project/releases/tag/llvmorg-<version>
ARG LLVM_VERSION=23.1.3
ARG LLVM_SHA256=ca9fe385a5d9e2d88132dc0e23a00e9f87f38fa75f67207b5e457d208e71d013
# rcodesign writes the ad hoc signature of the bundle, without a Mac and
# without a key: a signature made of hashes only.
#   https://github.com/indygreg/apple-platform-rs/releases/tag/apple-codesign%2F<version>
ARG RCODESIGN_VERSION=0.29.0
ARG RCODESIGN_SHA256=dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002

ENV PATH=/opt/cargo/bin:/opt/node/bin:/opt/llvm/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN curl --proto '=https' --tlsv1.2 --retry 5 -fsSL -o /tmp/llvm.tar.xz \
      "https://github.com/llvm/llvm-project/releases/download/llvmorg-${LLVM_VERSION}/LLVM-${LLVM_VERSION}-Linux-X64.tar.xz" \
 && echo "${LLVM_SHA256}  /tmp/llvm.tar.xz" | sha256sum -c - \
 && mkdir /opt/llvm \
 && top="LLVM-${LLVM_VERSION}-Linux-X64" major="${LLVM_VERSION%%.*}" \
 && tar -xJf /tmp/llvm.tar.xz -C /opt/llvm --strip-components=1 --no-same-owner \
      "$top/bin/clang-$major" "$top/bin/clang" "$top/bin/clang++" \
      "$top/bin/llvm-ar" "$top/bin/llvm-ranlib" "$top/bin/llvm-lipo" \
      "$top/bin/llvm-objdump" "$top/bin/llvm-otool" \
      "$top/lib/clang/$major/include" \
 && rm /tmp/llvm.tar.xz \
 && clang --version | grep -qF "clang version ${LLVM_VERSION} "

# The standard library for both Mac processors, fetched and checked by
# rust-dist like the compiler. The linker is the rust-lld of the pinned
# toolchain, as for Windows: clang finds it as ld64.lld next to itself.
# rustc strips the debug information of an Apple binary with the
# rust-objcopy of the toolchain, which 1.99.1 ships without a way to
# find the LLVM library it is linked against: without the link below,
# it fails, rustc only warns, and the binary keeps its debug map.
RUN rust-dist aarch64-apple-darwin rust-std \
 && rust-dist x86_64-apple-darwin rust-std \
 && CARGO_HOME=/opt/cargo RUSTUP_DIST_SERVER=file:///opt/rust-dist \
    all_proxy=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 \
    rustup target add aarch64-apple-darwin x86_64-apple-darwin \
 && find /opt/rust-dist/dist -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} + \
 && sysroot="$(rustc --print sysroot)" \
 && tools="$sysroot/lib/rustlib/x86_64-unknown-linux-gnu" \
 && ln -s "$tools/bin/gcc-ld/ld64.lld" /opt/llvm/bin/ld64.lld \
 && for lib in "$sysroot"/lib/libLLVM.so.*; do \
      [ -e "$tools/lib/$(basename "$lib")" ] || ln -s "$lib" "$tools/lib/"; \
    done \
 && "$tools/bin/rust-objcopy" --version | grep -qF 'LLVM version' \
 && ld64.lld --version | grep -qF 'LLD ' \
 && test -d "$(rustc --print target-libdir --target aarch64-apple-darwin)" \
 && test -d "$(rustc --print target-libdir --target x86_64-apple-darwin)"

RUN curl --proto '=https' --tlsv1.2 --retry 5 -fsSL -o /tmp/rcodesign.tar.gz \
      "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${RCODESIGN_VERSION}/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
 && echo "${RCODESIGN_SHA256}  /tmp/rcodesign.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/rcodesign.tar.gz -C /usr/local/bin --strip-components=1 --no-same-owner \
      "apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl/rcodesign" \
 && rm /tmp/rcodesign.tar.gz \
 && rcodesign --version | grep -qF "${RCODESIGN_VERSION}"

# zip writes the archive users download. cpio unpacks Xcode when the
# SDK is made from the .xip on Linux (reproducible/make-apple-sdk.sh).
# Both come from apt-macos.
RUN dpkg-query -W cpio zip > /dev/null
