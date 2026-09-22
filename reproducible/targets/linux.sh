# shellcheck shell=bash
# Linux target: .deb, .rpm and .AppImage for x86_64. Sourced by
# entrypoint.sh, which calls target_fetch with the network and
# target_build without it.
#
# Tauri's bundler makes the three packages, so their content is what a
# plain `npm run tauri build` ships: same desktop entry, same icons, same
# dependencies, same binary, which the bundler patches with the kind of
# package it sits in. What the bundler cannot do is leave the clock out,
# so each package is then brought to a canonical form:
#
#   .deb       unpacked and written again by dpkg-deb, which honours
#              SOURCE_DATE_EPOCH and sorts the archive members
#   .rpm       the two time tags overwritten in place (rpm-normalise.py)
#   .AppImage  the AppDir the bundler leaves behind fixed in two ways,
#              the icon linuxdeploy links at its root and the date of
#              every file, then the AppImage written again from it with
#              the same pinned plugin and runtime

TRIPLE=x86_64-unknown-linux-gnu
LINUXDEPLOY_SUMS="$APP/.github/linuxdeploy.sha256"
RUNTIME_SUMS="$APP/reproducible/linux/appimage-runtime.sha256"
LINUXDEPLOY_TOOLS="AppRun-x86_64 linuxdeploy-x86_64.AppImage linuxdeploy-plugin-gtk.sh linuxdeploy-plugin-gstreamer.sh linuxdeploy-plugin-appimage.AppImage"

target_fetch() {
    fetch_cargo "$TRIPLE"
    # The five tools the AppImage bundler would otherwise download by
    # itself, unchecked. URLs and hashes: .github/linuxdeploy.sha256.
    fetch_pinned "$LINUXDEPLOY_SUMS" AppRun-x86_64 \
        https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64
    fetch_pinned "$LINUXDEPLOY_SUMS" linuxdeploy-x86_64.AppImage \
        https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/linuxdeploy-x86_64.AppImage
    # The two scripts come from the commit that holds the pinned bytes,
    # not from the `master` branch the bundler names, which moves.
    fetch_pinned "$LINUXDEPLOY_SUMS" linuxdeploy-plugin-gtk.sh \
        https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/b5eb8d05b4c0ed40107fe2158c5d8527f94568ef/linuxdeploy-plugin-gtk.sh
    fetch_pinned "$LINUXDEPLOY_SUMS" linuxdeploy-plugin-gstreamer.sh \
        https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gstreamer/2a2e67491c32995a3f279ad0ecbe77abd512b42a/linuxdeploy-plugin-gstreamer.sh
    fetch_pinned "$LINUXDEPLOY_SUMS" linuxdeploy-plugin-appimage.AppImage \
        https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage
    # The sixth one, see linux/appimage-runtime.sha256.
    fetch_pinned "$RUNTIME_SUMS" runtime-x86_64 \
        https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64
}

target_build() {
    local version bundle tool
    version="$(app_version)"
    bundle="$APP/src-tauri/target/release/bundle"

    # Where the bundler looks before it downloads. It skips a download
    # when the file is there, and it only marks executable what it
    # downloaded itself.
    for tool in $LINUXDEPLOY_TOOLS; do
        use_pinned "$LINUXDEPLOY_SUMS" "$tool" "$XDG_CACHE_HOME/tauri/$tool"
        chmod 0755 "$XDG_CACHE_HOME/tauri/$tool"
    done
    use_pinned "$RUNTIME_SUMS" runtime-x86_64 "$WORK/tools/runtime-x86_64"
    export LDAI_RUNTIME_FILE="$WORK/tools/runtime-x86_64"
    # A container has no FUSE: the linuxdeploy AppImages unpack themselves.
    export APPIMAGE_EXTRACT_AND_RUN=1

    log "compiling"
    tauri_build --no-bundle
    (cd "$APP/src-tauri/target/release" && sha256sum gerfaut-desktop) > "$OUT/build-info/binary.sha256"
    check_binary "$APP/src-tauri/target/release/gerfaut-desktop"

    log "bundling"
    (cd "$APP" && npm run tauri -- bundle --ci --bundles deb,rpm,appimage)

    canonical_deb "$bundle/deb/Gerfaut_${version}_amd64.deb" "$OUT/Gerfaut_${version}_amd64.deb"
    canonical_rpm "$bundle/rpm/Gerfaut-${version}-1.x86_64.rpm" "$OUT/Gerfaut-${version}-1.x86_64.rpm"
    rewrite_appimage "$bundle/appimage/Gerfaut_${version}_amd64.AppImage"
    canonical_appimage "$bundle/appimage/Gerfaut_${version}_amd64.AppImage" "$OUT/Gerfaut_${version}_amd64.AppImage"
}

# No path of the build machine in the binary: the remap flags turn every
# one of them into /gerfaut, /cargo or /rustup.
check_binary() {
    if strings -n 6 "$1" | grep -E '^/(build|cache|opt|root|home|tmp)/' > /dev/null; then
        die "the binary embeds a path of the build container"
    fi
}

# Tauri writes the ar members and every tar entry with the wall clock,
# in the order its file walk found them. dpkg-deb writes the same tree
# with SOURCE_DATE_EPOCH as the only date, members sorted by name, owned
# by root. gzip for both members, as Tauri does: the default of this
# dpkg would be zstd, which older releases of Debian cannot open.
canonical_deb() {
    local from="$1" to="$2" tree="$WORK/deb-tree"
    rm -rf "$tree"
    dpkg-deb --raw-extract "$from" "$tree"
    # The order of the lines means nothing to dpkg and follows the same
    # file walk, so it is fixed too.
    sort -k2 "$tree/DEBIAN/md5sums" > "$tree/DEBIAN/md5sums.sorted"
    mv "$tree/DEBIAN/md5sums.sorted" "$tree/DEBIAN/md5sums"
    (cd "$tree" && md5sum --check --quiet --strict DEBIAN/md5sums)
    find "$tree" -exec touch --no-dereference --date="@$SOURCE_DATE_EPOCH" {} +
    dpkg-deb --root-owner-group --uniform-compression -Zgzip --build "$tree" "$to" > /dev/null
    rm -rf "$tree"
}

canonical_rpm() {
    local from="$1" to="$2"
    cp "$from" "$to"
    python3 "$APP/reproducible/linux/rpm-normalise.py" "$to" "$SOURCE_DATE_EPOCH"
    # rpm checks the digests the tool has just recomputed.
    rpm --checksig "$to" > /dev/null || die "the normalised rpm fails its own digests"
}

# Two things in the AppDir the bundler leaves behind depend on the
# machine, and the recipe fixes both before it writes the AppImage again
# from that AppDir, with the plugin, the runtime and the environment the
# bundler used: the bundler's last step, repeated. The contents of the
# files are left as they are.
#
# The icon linuxdeploy links at the root of the AppDir, named after the
# Icon= key of the desktop entry. The linuxdeploy Tauri pins takes the
# first matching icon its directory walk finds, and that order depends
# on the file system: two runners gave 32x32 and 64x64. linuxdeploy has
# since chosen by size (appdir_root_setup.cpp): the closer to 64x64 the
# better, the larger on a tie. The recipe applies that rule, with the
# path as the last tie-breaker.
#
# The dates. The mksquashfs inside appimagetool only brings a date later
# than SOURCE_DATE_EPOCH down to it, and leaves an earlier one alone.
# Some directories of the AppDir, such as the gtk-3.0 one the gtk plugin
# copies from the image, carry the date the image was built: a build
# with an image older than the commit kept that date, a build with a
# newer image did not. Every file and directory is dated
# SOURCE_DATE_EPOCH first.
rewrite_appimage() {
    local appimage="$1" appdir name link best icon size preference
    appdir="$(find "$(dirname "$appimage")" -mindepth 1 -maxdepth 1 -type d -name '*.AppDir')"
    [ -n "$appdir" ] && [ "$(printf '%s\n' "$appdir" | wc -l)" -eq 1 ] || die "not one AppDir next to $appimage"
    name="$(sed -n 's/^Icon=//p' "$appdir"/usr/share/applications/*.desktop)"
    [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || die "no single Icon= key in the desktop entry of the AppDir"
    link="$appdir/$name.png"
    [ -L "$link" ] || die "linuxdeploy left no icon link at $link"
    best="$(
        for icon in "$appdir"/usr/share/icons/hicolor/*/apps/"$name".png; do
            size="${icon#"$appdir"/usr/share/icons/hicolor/}"
            size="${size%%x*}"
            [[ "$size" =~ ^[0-9]+$ ]] || continue
            if [ "$size" -lt 64 ]; then preference=$(( 100 * size / 65 )); else preference=$(( 6400 / size )); fi
            printf '%s %s %s\n' "$preference" "$size" "${icon#"$appdir"/}"
        done | LC_ALL=C sort -k1,1nr -k2,2nr -k3,3 | head -n 1 | cut -d' ' -f3
    )"
    [ -n "$best" ] || die "no $name.png under usr/share/icons/hicolor in the AppDir"
    log "AppImage: the icon at the root of the AppDir is $best (linuxdeploy linked $(readlink "$link"))"
    ln -sfn "$best" "$link"
    find "$appdir" -exec touch --no-dereference --date="@$SOURCE_DATE_EPOCH" {} +
    rm "$appimage"
    (
        cd "$APP" || exit 1
        OUTPUT="$appimage" ARCH=x86_64 "$XDG_CACHE_HOME/tauri/linuxdeploy-plugin-appimage.AppImage" \
            --appdir "$appdir" > "$WORK/appimage-plugin.log" 2>&1
    ) || { cat "$WORK/appimage-plugin.log" >&2; die "linuxdeploy-plugin-appimage failed"; }
    [ -f "$appimage" ] || die "linuxdeploy-plugin-appimage wrote no $appimage"
}

# Nothing to rewrite. What is checked is that the file starts with the
# pinned runtime and not with one fetched on the side. appimagetool
# writes the MD5 of the payload into the runtime's .digest_md5 section,
# so those 16 bytes, and only those, may differ from the pinned file.
canonical_appimage() {
    local from="$1" to="$2" size section first last
    size="$(stat -c %s "$LDAI_RUNTIME_FILE")"
    section="$(readelf --sections --wide "$LDAI_RUNTIME_FILE" \
        | awk '{ for (i = 1; i < NF; i++) if ($i == ".digest_md5") print $(i + 3), $(i + 4) }')"
    [ -n "$section" ] || die "the pinned runtime has no .digest_md5 section"
    first=$(( 0x${section% *} + 1 ))
    last=$(( first + 0x${section#* } - 1 ))
    [ "$(stat -c %s "$from")" -gt "$size" ] || die "the AppImage is smaller than its runtime"
    # cmp exits 1 as soon as one byte differs, and 16 always do.
    { cmp --verbose --bytes="$size" "$from" "$LDAI_RUNTIME_FILE" || true; } \
        | awk -v first="$first" -v last="$last" '$1 < first || $1 > last { bad = 1 } END { exit bad }' \
        || die "the AppImage does not start with the pinned runtime"
    cp "$from" "$to"
    chmod 0755 "$to"
}
