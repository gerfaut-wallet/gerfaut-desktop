# Everything the release build takes from the Ubuntu archive, one image
# per target. The Apt image workflow (.github/workflows/apt-image.yml)
# builds them from this file and pushes them to
# ghcr.io/gerfaut-wallet/gerfaut-desktop-apt; reproducible/Dockerfile
# starts from them by digest. A release build then never talks to the
# archive, whose snapshot service can take half an hour to answer, or not
# answer at all, on the day of a tag.
#
# An image pushed from here changes no build until a reviewed commit
# writes its digest into reproducible/Dockerfile. Change a package or the
# snapshot here, run the workflow, then pin the digests its summary gives.
#
# The packages come from a dated snapshot of the archive, so this recipe
# installs the same versions next year: an image lost on GitHub is made
# again from here, with the same packages.

# Ubuntu 22.04, on purpose the oldest release still maintained: packages
# linked against its glibc 2.35 run on every distribution released since.
FROM ubuntu:22.04@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02 AS base

# The day the Ubuntu archive is frozen at. It must not be older than the
# base image, or apt would have to downgrade what the image already has.
ARG APT_SNAPSHOT=20260905T000000Z

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC \
    LANG=C \
    LC_ALL=C

SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

# Point apt at the snapshot and nowhere else. The snapshot service only
# speaks https and the base image has no certificate store yet, so the
# first install runs without checking the server's certificate. Nothing
# is lost: apt still checks the archive's signature against the keyring
# of the pinned base image, and every package against the signed index.
# The exception is removed as soon as ca-certificates is in.
#
# The snapshot service has bad minutes, sometimes bad quarters of an
# hour. apt retries each download, but its pauses stop at 30 seconds in
# all. `update --error-on=any` stops on an index it could not fetch: left
# to itself, apt only warns, carries on with no index, and fails later
# with a message that points elsewhere. Every stage installs through
# `apt-install <package>...`, which keeps both rules and, when a step
# still fails, waits 90 seconds and tries again, three times at most. The
# packages are downloaded first: a new try fetches only those missing,
# since the image's docker-clean empties the cache on `apt-get update`
# and after dpkg, never in between. The install itself then runs once,
# with downloads forbidden.
RUN printf '%s\n' \
      '#!/bin/bash' \
      'set -euo pipefail' \
      'retry() {' \
      '    for try in 1 2 3; do' \
      '        "$@" && return 0' \
      '        [ "$try" -lt 3 ] || break' \
      '        echo "apt-install: try $try of 3 failed: $*; next in 90 s" >&2' \
      '        sleep 90' \
      '    done' \
      '    echo "apt-install: try 3 of 3 failed: $*" >&2' \
      '    return 1' \
      '}' \
      'retry apt-get update --error-on=any' \
      'retry apt-get install -y --no-install-recommends --download-only "$@"' \
      'apt-get install -y --no-install-recommends --no-download "$@"' \
      > /usr/local/bin/apt-install \
 && chmod 0755 /usr/local/bin/apt-install \
 && echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80retries \
 && for pocket in jammy jammy-updates jammy-security; do \
      echo "deb https://snapshot.ubuntu.com/ubuntu/${APT_SNAPSHOT} ${pocket} main universe"; \
    done > /etc/apt/sources.list \
 && echo 'Acquire::https::snapshot.ubuntu.com::Verify-Peer "false";' > /etc/apt/apt.conf.d/99bootstrap \
 && apt-install ca-certificates \
 && rm /etc/apt/apt.conf.d/99bootstrap \
 && apt-install build-essential curl file git pkg-config python3 xz-utils \
 && rm -rf /var/lib/apt/lists/*


# --- Linux packages: .deb, .rpm, .AppImage -------------------------------
FROM base AS linux

# The list README.md gives, plus the packaging tools: dpkg-deb comes with
# the base system, rpm brings rpmbuild, squashfs-tools writes the
# AppImage payload, and desktop-file-utils checks the desktop entry.
RUN apt-install \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
      libdbus-1-dev patchelf wget xdg-utils \
      cpio desktop-file-utils rpm squashfs-tools zstd \
 && rm -rf /var/lib/apt/lists/*


# --- Windows installer: NSIS setup .exe, cross-built --------------------
FROM base AS windows

# clang-cl compiles the C code some crates carry (SQLite, zstd, ring,
# aws-lc), llvm-lib archives it and llvm-rc compiles the version
# resource. The linker is not in this list: it is the rust-lld of the
# pinned Rust toolchain. makensis comes with its stubs, the head of
# every installer it writes, so the nsis package is pinned like the rest.
RUN apt-install clang-15 llvm-15 nsis \
 && rm -rf /var/lib/apt/lists/*


# --- macOS application: Gerfaut.app in a zip, cross-built ---------------
FROM base AS macos

# zip writes the archive users download. cpio unpacks Xcode when the
# SDK is made from the .xip on Linux (reproducible/make-apple-sdk.sh).
RUN apt-install cpio zip \
 && rm -rf /var/lib/apt/lists/*
