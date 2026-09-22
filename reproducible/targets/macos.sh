# shellcheck shell=bash
# macOS target: Gerfaut.app for Apple silicon and Intel, in a zip,
# cross-built on Linux. Sourced by entrypoint.sh, which calls
# target_fetch with the network and target_build without it.
#
# The application is compiled twice through the Tauri CLI, once for
# aarch64-apple-darwin and once for x86_64-apple-darwin, as
# `tauri build --target universal-apple-darwin` does on a Mac, and
# llvm-lipo joins the two into one universal binary. clang compiles the
# C and Objective-C code some crates carry, the rust-lld of the pinned
# toolchain links, against the Apple SDK of whoever builds.
#
# Tauri's macOS bundler only compiles on a Mac, so the recipe lays the
# bundle out itself, the way that bundler does: Contents/Info.plist
# (reproducible/macos/info-plist.py), Contents/MacOS/<binary> and
# Contents/Resources/icon.icns. rcodesign then signs it ad hoc, and zip
# writes Gerfaut_<version>_universal.zip.
#
# The Apple SDK is not free software. It is in no image and in no
# repository: build.sh mounts the copy of whoever builds, read-only, into
# the build container only, never into the one that has the network.
# It is checked against reproducible/macos/apple-sdk.sha256 on the host
# and again here.
#
# What keeps the clock and the machine out:
#   - lld writes no date into a Mach-O file, and derives its UUID from
#     the content;
#   - -no_adhoc_codesign: the linker signs no slice. The bundle is signed
#     once assembled, and the linker's signature would take the name of
#     the file rustc links to as its identifier, which Bitcoin Core turns
#     it off for;
#   - rcodesign signs without a key, so without a time or a server;
#   - every date in the zip is SOURCE_DATE_EPOCH, in UTC, entries sorted,
#     no extra field.

MACOS="$APP/reproducible/macos"
TRIPLES=(aarch64-apple-darwin x86_64-apple-darwin)
SDK_SUMS="$MACOS/apple-sdk.sha256"
# The tree both SDK tarballs unpack into, named by gen-sdk.py.
SDK="$WORK/apple-sdk/Xcode-26.1.1-17B100-extracted-SDK-with-libcxx-headers"
# The version of that SDK, which the linker records in each slice as
# Xcode's does: gen-sdk.py leaves out the file clang would read it from.
SDK_VERSION=26.1

target_fetch() {
    # Build scripts and procedural macros are compiled for the container,
    # so the crates of the three platforms are needed.
    fetch_cargo x86_64-unknown-linux-gnu "${TRIPLES[@]}"
}

# build.sh mounts each tarball apple-sdk.sha256 names under /sdk.
unpack_sdk() {
    local want name
    rm -rf "$WORK/apple-sdk"
    mkdir -p "$WORK/apple-sdk"
    while read -r want name; do
        [ -f "/sdk/$name" ] || die "no $name: build.sh needs --macos-sdk"
        log "Apple SDK: checking and unpacking $name"
        echo "$want  /sdk/$name" | sha256sum --check --status \
            || die "/sdk/$name does not match reproducible/macos/apple-sdk.sha256"
        tar -xf "/sdk/$name" -C "$WORK/apple-sdk" --no-same-owner
    done < <(awk '!/^#/ && $2 ~ /[.]tar$/' "$SDK_SUMS")
    [ -f "$SDK/System/Library/Frameworks/AppKit.framework/AppKit.tbd" ] || die "the SDK has no AppKit"
    [ -f "$SDK/System/Library/Frameworks/WebKit.framework/WebKit.tbd" ] || die "the SDK has no WebKit"
}

# What the Xcode toolchain would give each build on a Mac, written out:
# which compiler, archiver and linker, and where the SDK is. cc-rs reads
# the most specific variable and nothing else, so the prefix maps of
# lib.sh are repeated here.
macos_env() {
    local triple var flags
    flags="-isysroot $SDK -ffile-prefix-map=$WORK=/gerfaut -ffile-prefix-map=$CARGO_HOME=/cargo -ffile-prefix-map=$SDK=/sdk"
    export SDKROOT="$SDK"
    # aws-lc-sys would otherwise pick CMake, whose Apple branch only runs
    # on a Mac. Its own cc-based build is the one it uses by default
    # whenever CMake is not asked for.
    export AWS_LC_SYS_CMAKE_BUILDER=0
    for triple in "${TRIPLES[@]}"; do
        var="${triple//-/_}"
        export "CC_$var=clang" "CXX_$var=clang++" "AR_$var=llvm-ar"
        export "CFLAGS_$var=$flags" "CXXFLAGS_$var=$flags"
        export "CARGO_TARGET_${var^^}_LINKER=clang"
    done
    BASE_RUSTFLAGS="$CARGO_ENCODED_RUSTFLAGS"
}

# The oldest macOS a slice runs on: what rustc derives for that processor
# from MACOSX_DEPLOYMENT_TARGET, which the Tauri CLI sets from
# LSMinimumSystemVersion. rustc never goes below 11.0 for Apple silicon.
deployment_target() {
    local version
    version="$(MACOSX_DEPLOYMENT_TARGET="$MINIMUM_SYSTEM_VERSION" \
        rustc --print deployment-target --target "$1" | sed -n 's/^MACOSX_DEPLOYMENT_TARGET=//p')"
    [[ "$version" =~ ^[0-9]+\.[0-9]+$ ]] || die "rustc gives no deployment target for $1"
    echo "$version"
}

# rustc hands the link to clang with -arch and the deployment target,
# which a clang built for Linux does not read as "link for a Mac": the
# target is given again. -platform_version records the SDK version in
# the slice, as Xcode's linker does; clang would write 0.0 without it.
#
# -lframework=Foundation puts Foundation ahead of every other library.
# Some symbols, the NSHTTPCookie keys WebKit's cookies use, are exported
# by Foundation and by CFNetwork, which Carbon brings in through
# CoreServices before Foundation on rustc's command line. lld binds a
# symbol to the first library that has it, Xcode's linker to Foundation:
# without the flag the slice would load CFNetwork for them, which Xcode's
# does not, and would expect them there on every macOS it runs on.
link_flags() {
    local triple="$1" minos="$2" us=$'\x1f' llvm
    case "$triple" in
        aarch64-apple-darwin) llvm=arm64-apple-macos ;;
        x86_64-apple-darwin) llvm=x86_64-apple-macos ;;
    esac
    printf '%s' "${BASE_RUSTFLAGS}${us}-Clink-arg=--target=$llvm${us}-Clink-arg=-fuse-ld=lld" \
        "${us}-Clink-arg=-Wl,-no_adhoc_codesign" \
        "${us}-Clink-arg=-Wl,-platform_version,macos,$minos,$SDK_VERSION" \
        "${us}-lframework=Foundation"
}

target_build() {
    local version stage app name executable icon triple minos release slices=()
    version="$(app_version)"
    stage="$WORK/macos-bundle"
    rm -rf "$stage"
    mkdir -p "$stage"

    unpack_sdk
    # The plist first: the bundle name, the binary name and the oldest
    # macOS the build targets are all read back from it.
    python3 "$MACOS/info-plist.py" "$APP/src-tauri" "$stage/Info.plist"
    name="$(plist_value "$stage/Info.plist" CFBundleName)"
    executable="$(plist_value "$stage/Info.plist" CFBundleExecutable)"
    icon="$(plist_value "$stage/Info.plist" CFBundleIconFile)"
    MINIMUM_SYSTEM_VERSION="$(plist_value "$stage/Info.plist" LSMinimumSystemVersion)"
    macos_env

    for triple in "${TRIPLES[@]}"; do
        log "compiling for $triple"
        release="$APP/src-tauri/target/$triple/release"
        minos="$(deployment_target "$triple")"
        CARGO_ENCODED_RUSTFLAGS="$(link_flags "$triple" "$minos")"
        tauri_build --target "$triple" --no-bundle
        check_slice "$release/$executable" "$triple" "$minos"
        slices+=("$release/$executable")
    done
    CARGO_ENCODED_RUSTFLAGS="$BASE_RUSTFLAGS"

    log "joining the two slices"
    llvm-lipo -create -output "$stage/$executable" "${slices[@]}"
    [ "$(archs "$stage/$executable")" = "x86_64 arm64" ] \
        || die "the universal binary does not hold x86_64 and arm64"
    (
        cd "$APP/src-tauri/target" || exit 1
        sha256sum "aarch64-apple-darwin/release/$executable" "x86_64-apple-darwin/release/$executable"
        cd "$stage" && sha256sum "$executable"
    ) > "$OUT/build-info/binary.sha256"
    macho_summary "$stage/$executable" > "$OUT/build-info/macho.txt"

    log "assembling $name.app"
    app="$stage/$name.app"
    mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    mv "$stage/Info.plist" "$app/Contents/Info.plist"
    mv "$stage/$executable" "$app/Contents/MacOS/$executable"
    cp "$APP/src-tauri/$(icns_source)" "$app/Contents/Resources/$icon"
    find "$app" -type d -exec chmod 0755 {} +
    find "$app" -type f -exec chmod 0644 {} +
    chmod 0755 "$app/Contents/MacOS/$executable"

    log "signing ad hoc"
    sign_app "$app"
    check_paths "$app/Contents/MacOS/$executable"

    log "writing the zip"
    zip_app "$stage" "$name.app" "$OUT/${name}_${version}_universal.zip"
}

# The .icns Tauri's bundler copies: the first one bundle.icon lists.
icns_source() {
    python3 -c 'import json, sys
print(next(i for i in json.load(open(sys.argv[1]))["bundle"]["icon"] if i.endswith(".icns")))' \
        "$APP/src-tauri/tauri.conf.json"
}

# The processors a Mach-O file is for, as llvm-lipo lists them.
archs() {
    llvm-lipo -archs "$1" | xargs
}

plist_value() {
    python3 -c 'import plistlib, sys; print(plistlib.load(open(sys.argv[1], "rb"))[sys.argv[2]])' "$1" "$2"
}

# The Mach-O header of a slice, as the recipe expects it: the right
# processor, the right oldest macOS, the SDK version, and no signature
# from the linker.
check_slice() {
    local file="$1" triple="$2" want="$3" arch headers minos sdk
    case "$triple" in
        aarch64-apple-darwin) arch=arm64 ;;
        x86_64-apple-darwin) arch=x86_64 ;;
    esac
    [ "$(archs "$file")" = "$arch" ] || die "$file is not a $arch binary"
    headers="$(llvm-objdump --macho --private-headers "$file")"
    # Below macOS 10.14 the linker writes the older LC_VERSION_MIN_MACOSX,
    # as Apple's does, where the oldest version is called "version".
    minos="$(awk '$1 == "cmd" { cmd = $2 }
        cmd ~ /^LC_(BUILD_VERSION|VERSION_MIN_MACOSX)$/ && $1 ~ /^(minos|version)$/ { print $2; exit }' <<< "$headers")"
    sdk="$(awk '$1 == "cmd" { cmd = $2 }
        cmd ~ /^LC_(BUILD_VERSION|VERSION_MIN_MACOSX)$/ && $1 == "sdk" { print $2; exit }' <<< "$headers")"
    [ "$minos" = "$want" ] || die "$triple: the slice targets macOS $minos, not $want"
    [ "$sdk" = "$SDK_VERSION" ] || die "$triple: the slice records SDK $sdk"
    ! llvm-objdump --macho --dylibs-used "$file" | grep -q '/CFNetwork.framework/' \
        || die "$triple: the slice loads CFNetwork, which Xcode's linker leaves out"
    ! grep -q 'cmd LC_CODE_SIGNATURE' <<< "$headers" || die "$triple: the linker signed the slice"
    check_paths "$file"
}

# No path of the build machine in the binary: the remap flags turn every
# one of them into /gerfaut, /cargo, /rustup or /sdk.
check_paths() {
    if strings -n 6 "$1" | grep -E '^/(build|cache|opt|root|home|tmp)/' > /dev/null; then
        die "$1 embeds a path of the build container"
    fi
}

# For build-info: what each slice targets, which libraries it loads and
# its UUID, the fields to compare with a build made on a Mac.
macho_summary() {
    local arch
    for arch in arm64 x86_64; do
        echo "== $arch"
        llvm-objdump --macho --arch="$arch" --private-headers "$1" \
            | awk '$1 == "cmd" { cmd = $2 }
                cmd ~ /^LC_(BUILD_VERSION|VERSION_MIN_MACOSX|UUID)$/ && $1 ~ /^(platform|minos|version|sdk|uuid)$/ { print cmd, $1, $2 }'
        llvm-objdump --macho --arch="$arch" --dylibs-used "$1" | tail -n +2 | sed 's/ (compatibility.*//; s/^[[:space:]]*//'
    done
}

# An ad hoc signature, as Tauri's bundler writes it when asked to sign
# with the identity "-": the binary and the bundle sealed together
# (_CodeSignature/CodeResources), the identifier taken from
# CFBundleIdentifier, the hardened runtime on, which is Tauri's default.
# No key, so no certificate, no time and no server.
sign_app() {
    local executable
    executable="$(plist_value "$1/Contents/Info.plist" CFBundleExecutable)"
    # --config-file /dev/null: no configuration file on the machine is read.
    rcodesign sign --config-file /dev/null --code-signature-flags runtime --timestamp-url none "$1" > /dev/null
    rcodesign print-signature-info --config-file /dev/null "$1/Contents/MacOS/$executable" \
        > "$OUT/build-info/signature.txt"
}

# Every date is the commit date, the entries are sorted by name, the
# modes are the ones set above and no extra field is written. Zipped
# after signing: the signature covers the content of the files, not
# their dates.
zip_app() {
    local stage="$1" top="$2" zip="$3"
    (
        cd "$stage" || exit 1
        find "$top" -exec touch --no-dereference --date="@$SOURCE_DATE_EPOCH" {} +
        find "$top" -print | LC_ALL=C sort | TZ=UTC zip -X -q -@ "$zip"
    )
    python3 -m zipfile -t "$zip" > /dev/null || die "the zip does not read back"
    python3 -m zipfile -l "$zip" > "$OUT/build-info/zip-listing.txt"
}
