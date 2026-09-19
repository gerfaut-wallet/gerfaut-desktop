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
#   .AppImage  nothing to fix once appimagetool is given a pinned runtime
#              and SOURCE_DATE_EPOCH, which its mksquashfs honours

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
    fetch_pinned "$LINUXDEPLOY_SUMS" linuxdeploy-plugin-gtk.sh \
        https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh
    fetch_pinned "$LINUXDEPLOY_SUMS" linuxdeploy-plugin-gstreamer.sh \
        https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gstreamer/master/linuxdeploy-plugin-gstreamer.sh
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
