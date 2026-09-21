# shellcheck shell=bash
# Windows target: the NSIS installer for x86_64, cross-built on Linux.
# Sourced by entrypoint.sh, which calls target_fetch with the network and
# target_build without it.
#
# The target is x86_64-pc-windows-msvc, the only one Tauri supports and
# the one the WebView2 loader links statically against: the application
# is a single .exe. clang-cl compiles the C code, the rust-lld of the
# pinned toolchain links, llvm-rc compiles the version resource, and
# makensis writes the installer from Tauri's own template.
#
# The Microsoft C runtime and Windows SDK are needed to link. They are
# not free software, so they are in no image and in no repository: the
# fetch phase downloads them from Microsoft, with xwin and the committed
# manifest, on the machine of whoever builds, and only once that person
# has accepted Microsoft's licence (build.sh --accept-microsoft-license).
# Every file is checked against reproducible/windows/microsoft-sdk.sha256.
#
# What keeps the clock out:
#   - /Brepro and /DEBUG:NONE: the linker writes a hash of the image
#     where the PE header has a timestamp, and that image names no file
#     of the build;
#   - SetDateSave off, through reproducible/windows/hooks.nsh: makensis
#     stores no file time;
#   - a pinned nsis package: the stub at the head of the installer, and
#     of the uninstaller inside it, is a file of that package.

TRIPLE=x86_64-pc-windows-msvc
WINDOWS="$APP/reproducible/windows"
MICROSOFT="$CACHE/microsoft"
SDK="$MICROSOFT/sdk"
LICENSE_URL="https://go.microsoft.com/fwlink/?LinkId=2086102"
PLUGIN_URL="https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll"
# The package manifest manifest_17.json points at, and the name xwin
# gives it in its download directory.
VSMAN_URL="https://download.visualstudio.microsoft.com/download/pr/bc92e2cb-33de-4a0c-995d-efa817f16b16/6e470016e4324c84c255ffd0beb3767d17ec89cc8561e9409ee3e1f6d29400f5/VisualStudio.vsman"
VSMAN_NAME="pkg_manifest_6e470016e4324c84c255ffd0beb3767d17ec89cc8561e9409ee3e1f6d29400f5.vsman"

target_fetch() {
    # First, so a build that lacks the licence flag stops at once.
    fetch_microsoft_sdk
    # Build scripts and procedural macros are compiled for the container,
    # so the crates of both platforms are needed.
    fetch_cargo x86_64-unknown-linux-gnu "$TRIPLE"
    fetch_pinned "$WINDOWS/nsis-plugin.sha256" nsis_tauri_utils.dll "$PLUGIN_URL"
}

# One hash for the whole tree: see reproducible/windows/microsoft-sdk-tree.sha256.
sdk_tree_hash() {
    (
        cd "$1" || exit 1
        find . -type f -print0 | sort -z | xargs -0 sha256sum
        find . -type l -printf '%p -> %l\n' | sort
        find . -type d | sort
    ) | sha256sum | cut -d' ' -f1
}

sdk_tree_wanted() {
    awk '!/^#/ && $2 == "sdk" { print $1 }' "$WINDOWS/microsoft-sdk-tree.sha256"
}

fetch_microsoft_sdk() {
    local dl="$MICROSOFT/xwin/dl" xwin_args
    if [ -d "$SDK" ] && [ "$(sdk_tree_hash "$SDK")" = "$(sdk_tree_wanted)" ]; then
        log "Microsoft C runtime and Windows SDK: already in the cache"
        return
    fi
    if [ "${GERFAUT_ACCEPT_MICROSOFT_LICENSE:-}" != 1 ]; then
        die "the Windows build links against the Microsoft C runtime and Windows SDK.
They are downloaded from Microsoft to this machine and are not part of Gerfaut.
Read the licence, $LICENSE_URL
and run again with --accept-microsoft-license if you accept it."
    fi
    log "Microsoft C runtime and Windows SDK: downloading (licence accepted with --accept-microsoft-license)"
    grep -qF "$VSMAN_URL" "$WINDOWS/manifest_17.json" \
        || die "manifest_17.json does not point at the package manifest this recipe pins"
    rm -rf "$SDK" "$MICROSOFT/xwin/unpack"
    mkdir -p "$dl"
    # xwin reads the package manifest from its download directory when it
    # is there, so it only ever sees the checked copy.
    fetch_pinned "$WINDOWS/microsoft-sdk.sha256" "$VSMAN_NAME" "$VSMAN_URL"
    cp "$CACHE/tools/$VSMAN_NAME" "$dl/$VSMAN_NAME"

    xwin_args=(--accept-license --log-level warn --manifest "$WINDOWS/manifest_17.json"
        --cache-dir "$MICROSOFT/xwin" --arch x86_64 --variant desktop
        --http-retry 3)
    xwin "${xwin_args[@]}" download
    # The whole directory against the whole list: nothing missing,
    # nothing extra, nothing different.
    (cd "$dl" && find . -type f ! -name manifest_17.json -printf '%P\0' | sort -z | xargs -0 sha256sum) \
        | diff - <(grep -v '^#' "$WINDOWS/microsoft-sdk.sha256") > /dev/null \
        || die "what Microsoft served is not what reproducible/windows/microsoft-sdk.sha256 lists"

    xwin "${xwin_args[@]}" splat --output "$SDK"
    rm -rf "$MICROSOFT/xwin/unpack"
    [ "$(sdk_tree_hash "$SDK")" = "$(sdk_tree_wanted)" ] \
        || die "the unpacked SDK does not match reproducible/windows/microsoft-sdk-tree.sha256"
}

# What cargo-xwin would set up, written out: which tools to call and
# where the headers and the libraries are.
windows_env() {
    local us=$'\x1f' include lib
    include="/imsvc $SDK/crt/include /imsvc $SDK/sdk/include/ucrt /imsvc $SDK/sdk/include/um /imsvc $SDK/sdk/include/shared"
    export CC_x86_64_pc_windows_msvc=clang-cl
    export CXX_x86_64_pc_windows_msvc=clang-cl
    export AR_x86_64_pc_windows_msvc=llvm-lib
    # The cc crate reads the most specific variable and nothing else, so
    # the prefix maps of lib.sh are repeated here, in the spelling
    # clang-cl wants for an option that is not one of cl.exe.
    maps="/clang:-ffile-prefix-map=$WORK=/gerfaut /clang:-ffile-prefix-map=$CARGO_HOME=/cargo /clang:-ffile-prefix-map=$MICROSOFT=/microsoft"
    export CFLAGS_x86_64_pc_windows_msvc="--target=$TRIPLE -Wno-unused-command-line-argument $include $maps"
    export CXXFLAGS_x86_64_pc_windows_msvc="$CFLAGS_x86_64_pc_windows_msvc"
    export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=rust-lld
    for lib in crt/lib/x86_64 sdk/lib/um/x86_64 sdk/lib/ucrt/x86_64; do
        CARGO_ENCODED_RUSTFLAGS="${CARGO_ENCODED_RUSTFLAGS}${us}-Lnative=$SDK/$lib"
    done
    # /Brepro: the linker writes a hash of the image where the PE header
    # has a timestamp.
    # /DEBUG:NONE: rustc asks for a .pdb file even in a release build,
    # and the linker then derives that hash, and the identifier it
    # writes next to the name of the .pdb, from the content of the .pdb.
    # That content names the temporary directory rustc links in, which
    # is random. The .pdb is not shipped, so nothing is lost with it.
    export CARGO_ENCODED_RUSTFLAGS="${CARGO_ENCODED_RUSTFLAGS}${us}-Clink-arg=/Brepro${us}-Clink-arg=/DEBUG:NONE"
}

target_build() {
    local version release bundle
    version="$(app_version)"
    release="$APP/src-tauri/target/$TRIPLE/release"
    bundle="$release/bundle/nsis/Gerfaut_${version}_x64-setup.exe"

    [ -d "$SDK" ] && [ "$(sdk_tree_hash "$SDK")" = "$(sdk_tree_wanted)" ] \
        || die "the Microsoft SDK in the cache does not match microsoft-sdk-tree.sha256: run the fetch phase again"
    windows_env

    # Where the bundler looks before it downloads.
    use_pinned "$WINDOWS/nsis-plugin.sha256" nsis_tauri_utils.dll \
        "$XDG_CACHE_HOME/tauri/NSIS/Plugins/x86-unicode/additional/nsis_tauri_utils.dll"

    log "compiling"
    tauri_build --target "$TRIPLE" --no-bundle
    (cd "$release" && sha256sum gerfaut-desktop.exe) > "$OUT/build-info/binary.sha256"
    check_exe "$release/gerfaut-desktop.exe"

    log "bundling"
    (
        cd "$APP" || exit 1
        npm run tauri -- bundle --ci --target "$TRIPLE" --bundles nsis \
            --config '{"bundle":{"windows":{"nsis":{"installerHooks":"../reproducible/windows/hooks.nsh"}}}}'
    )
    cp "$bundle" "$OUT/"
}

# No path of the build machine in the binary, in either of the two
# encodings a Windows program keeps its strings in.
check_exe() {
    local encoding
    for encoding in s l; do
        if strings -n 6 -e "$encoding" "$1" | grep -E '^/(build|cache|opt|root|home|tmp)/' > /dev/null; then
            die "the binary embeds a path of the build container"
        fi
    done
}
