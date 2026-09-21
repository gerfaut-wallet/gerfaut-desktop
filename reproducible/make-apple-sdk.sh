#!/usr/bin/env bash
# Makes the Apple SDK the macOS build needs, from the Xcode archive you
# downloaded from Apple, on Linux.
#
#   reproducible/make-apple-sdk.sh Xcode_26.1.1_Apple_silicon.xip [DIR]
#
# It checks the archive against reproducible/macos/apple-sdk.sha256,
# unpacks the part of Xcode that holds the SDK and turns it into the two
# tarballs the build takes, in the pinned image and without network. It
# writes them into DIR (default: ./apple-sdk) and checks them. They are
# for your own builds: Apple's licence does not let you share them. Read
# docs/REPRODUCIBLE-BUILDS.md first.
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"

[ $# -ge 1 ] && [ $# -le 2 ] && [ -f "$1" ] || {
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
    exit 2
}
xip="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
out="${2:-$PWD/apple-sdk}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

. "$here/engine.sh"

sums="$here/macos/apple-sdk.sha256"
wanted() { awk -v n="$1" '!/^#/ && $2 == n { print $1 }' "$sums"; }
sha256() {
    if command -v sha256sum > /dev/null 2>&1; then sha256sum < "$1" | cut -d' ' -f1
    else shasum -a 256 < "$1" | cut -d' ' -f1; fi
}
xip_name=Xcode_26.1.1_Apple_silicon.xip
sdk_name=Xcode-26.1.1-17B100-extracted-SDK-with-libcxx-headers.tar
cryptexes_name=Xcode-26.1.1-17B100-extracted-SDK-cryptexes.tar

echo "==> checking $(basename "$xip")"
[ "$(sha256 "$xip")" = "$(wanted "$xip_name")" ] || {
    echo "this is not $xip_name as Apple publishes it: its sha256 differs from reproducible/macos/apple-sdk.sha256" >&2
    exit 1
}
for name in "$sdk_name" "$cryptexes_name"; do
    [ ! -e "$out/$name" ] || { echo "$out/$name already exists" >&2; exit 1; }
done

image=gerfaut-desktop-rb:macos
echo "==> building $image"
build_image macos "$image" "$repo" HEAD

# Xcode unpacks to about 12 GB. Only its version file and the SDK are
# written, inside the container, which is removed at the end.
echo "==> unpacking the SDK from Xcode (10 to 20 minutes)"
# shellcheck disable=SC2016,SC2086
engine run --rm --network none --entrypoint bash \
    -v "$(hostpath "$xip"):/in/$xip_name:ro" \
    -v "$(hostpath "$here/macos"):/tools:ro" \
    -v "$(hostpath "$out"):/out" \
    ${GERFAUT_RUN_ARGS:-} \
    "$image" -euo pipefail -c '
        cd /tmp
        python3 /tools/extract_xcode.py -f "/in/$1" \
            | cpio -d -i --quiet \
                "Xcode.app/Contents/version.plist" "./Xcode.app/Contents/version.plist" \
                "Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/*" \
                "./Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/*"
        python3 /tools/gen-sdk.py Xcode.app -o "/out/$2.part" > /dev/null
        python3 /tools/gen-sdk-cryptexes.py Xcode.app -o "/out/$3.part"
        owner="$(stat -c %u:%g /out)"
        for name in "$2" "$3"; do
            mv "/out/$name.part" "/out/$name"
            [ "$owner" = 0:0 ] || chown "$owner" "/out/$name"
        done
    ' make-apple-sdk "$xip_name" "$sdk_name" "$cryptexes_name"

failed=0
for name in "$sdk_name" "$cryptexes_name"; do
    have="$(sha256 "$out/$name")"
    if [ "$have" = "$(wanted "$name")" ]; then
        echo "    $have  $name"
    else
        echo "==> $name does not match: $have" >&2
        echo "    reproducible/macos/apple-sdk.sha256 wants $(wanted "$name")" >&2
        mv "$out/$name" "$out/$name.mismatch"
        failed=1
    fi
done
[ "$failed" -eq 0 ] || exit 1
echo "==> the Apple SDK is in $out, pass it to the build with --macos-sdk $out"
