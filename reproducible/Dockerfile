# Pinned toolchain for reproducible Gerfaut desktop builds.
#
# One file, one stage per target. `base` holds what every target shares:
# the operating system, the compiler and Node. `linux` adds what the
# Linux packages need, `windows` what the cross-built Windows installer
# needs. `tools` adds diffoscope and is only ever used to
# explain a mismatch, never to build.
#
# Everything that can reach an artefact is frozen:
#   - the base image by digest;
#   - every apt package by a dated snapshot of the Ubuntu archive, so the
#     same recipe installs the same versions next year;
#   - rustup by the hash of its installer, the Rust toolchain by the hash
#     of its release manifest, which in turn lists the hash of every
#     component rustup downloads;
#   - Node by the hash of its tarball.
#
# The image holds the toolchain and nothing else. The recipe that runs in
# it is reproducible/targets/<target>.sh of the very commit being built,
# handed over read-only under /src. Build and run it through
# reproducible/build.sh.

# Ubuntu 22.04, on purpose the oldest release still maintained: packages
# linked against its glibc 2.35 run on every distribution released since.
FROM ubuntu:22.04@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02 AS base

# The day the Ubuntu archive is frozen at. It must not be older than the
# base image, or apt would have to downgrade what the image already has.
ARG APT_SNAPSHOT=20260905T000000Z

# reproducible/build.sh reads the channel from rust-toolchain.toml and
# passes it here, so the compiler is named in one place only. The
# manifest hash has to follow it:
#   curl -fsSL https://static.rust-lang.org/dist/channel-rust-<version>.toml | sha256sum
ARG RUST_VERSION=1.97.0
ARG RUST_MANIFEST_SHA256=3804d2666f7c12ce64205baa69b6be52f910b45b158091013264beb7aa1de7f5
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

# Point apt at the snapshot and nowhere else. The snapshot service only
# speaks https and the base image has no certificate store yet, so the
# first install runs without checking the server's certificate. Nothing
# is lost: apt still checks the archive's signature against the keyring
# of the pinned base image, and every package against the signed index.
# The exception is removed as soon as ca-certificates is in.
RUN for pocket in jammy jammy-updates jammy-security; do \
      echo "deb https://snapshot.ubuntu.com/ubuntu/${APT_SNAPSHOT} ${pocket} main universe"; \
    done > /etc/apt/sources.list \
 && echo 'Acquire::https::snapshot.ubuntu.com::Verify-Peer "false";' > /etc/apt/apt.conf.d/99bootstrap \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm /etc/apt/apt.conf.d/99bootstrap \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential curl file git pkg-config python3 xz-utils \
 && rm -rf /var/lib/apt/lists/*

# rustup, then the toolchain. The manifest is checked first: it is the
# file rustup reads the component hashes from.
RUN curl --proto '=https' --tlsv1.2 -fsSL -o /tmp/rustup-init \
      "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
 && echo "${RUSTUP_INIT_SHA256}  /tmp/rustup-init" | sha256sum -c - \
 && curl --proto '=https' --tlsv1.2 -fsSL -o /tmp/channel.toml \
      "https://static.rust-lang.org/dist/channel-rust-${RUST_VERSION}.toml" \
 && echo "${RUST_MANIFEST_SHA256}  /tmp/channel.toml" | sha256sum -c - \
 && chmod +x /tmp/rustup-init \
 && CARGO_HOME=/opt/cargo /tmp/rustup-init -y --no-modify-path --profile minimal \
      --default-toolchain "${RUST_VERSION}" --component rustfmt --component clippy \
 && rm /tmp/rustup-init /tmp/channel.toml \
 && rustc --version | grep -qF "rustc ${RUST_VERSION} "

RUN curl --proto '=https' --tlsv1.2 -fsSL -o /tmp/node.tar.xz \
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

# The list README.md gives, plus the packaging tools: dpkg-deb comes with
# the base system, rpm brings rpmbuild, squashfs-tools writes the
# AppImage payload, and desktop-file-utils checks the desktop entry.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
      libdbus-1-dev patchelf wget xdg-utils \
      cpio desktop-file-utils rpm squashfs-tools zstd \
 && rm -rf /var/lib/apt/lists/* \
 && dpkg-query -W -f '${Package} ${Version} ${Architecture}\n' | sort > /etc/gerfaut-image-packages


# --- Windows installer: NSIS setup .exe, cross-built --------------------
FROM base AS windows

# xwin downloads the Microsoft C runtime and the Windows SDK and lays
# them out for a Linux compiler. The image holds the tool, never what it
# downloads: that happens in the fetch phase of each build, on the
# machine of whoever builds, and lands in the cache volume.
#   https://github.com/Jake-Shadle/xwin/releases
ARG XWIN_VERSION=0.10.0
ARG XWIN_SHA256=d870eb4b2f390878af6da1ccd3cf321d22fcb72720984853b4be732ae597fc88

# clang-cl compiles the C code some crates carry (SQLite, zstd, ring,
# aws-lc), llvm-lib archives it and llvm-rc compiles the version
# resource. The linker is not in this list: it is the rust-lld of the
# pinned Rust toolchain. makensis comes with its stubs, the head of
# every installer it writes, so the nsis package is part of the promise.
RUN apt-get update \
 && apt-get install -y --no-install-recommends clang-15 llvm-15 nsis \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/lib/llvm-15/bin/clang /usr/local/bin/clang-cl \
 && ln -s /usr/lib/llvm-15/bin/llvm-lib /usr/local/bin/llvm-lib \
 && ln -s /usr/lib/llvm-15/bin/llvm-rc /usr/local/bin/llvm-rc \
 && clang-cl --version | grep -qF 'clang version 15.' \
 && dpkg-query -W -f '${Package} ${Version} ${Architecture}\n' | sort > /etc/gerfaut-image-packages

# The standard library for Windows. rustup reads its hash from the
# release manifest of the toolchain the base stage installed, the same
# file that lists the compiler itself.
RUN CARGO_HOME=/opt/cargo rustup target add x86_64-pc-windows-msvc \
 && test -d "$(rustc --print target-libdir --target x86_64-pc-windows-msvc)"

RUN curl --proto '=https' --tlsv1.2 -fsSL -o /tmp/xwin.tar.gz \
      "https://github.com/Jake-Shadle/xwin/releases/download/${XWIN_VERSION}/xwin-${XWIN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
 && echo "${XWIN_SHA256}  /tmp/xwin.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/xwin.tar.gz -C /usr/local/bin --strip-components=1 --no-same-owner \
      "xwin-${XWIN_VERSION}-x86_64-unknown-linux-musl/xwin" \
 && rm /tmp/xwin.tar.gz \
 && xwin --version | grep -qF "${XWIN_VERSION}"


# --- Explaining a mismatch ----------------------------------------------
# diffoscope, with what it needs to read an rpm header and to print a
# hex dump.
FROM linux AS tools

RUN apt-get update \
 && apt-get install -y --no-install-recommends diffoscope-minimal python3-rpm xxd \
 && rm -rf /var/lib/apt/lists/*

ENTRYPOINT []
