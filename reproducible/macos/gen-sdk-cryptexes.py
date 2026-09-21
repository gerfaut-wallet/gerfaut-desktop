#!/usr/bin/env python3
"""Write the part of the macOS SDK that gen-sdk.py leaves out and Gerfaut links against.

    gen-sdk-cryptexes.py /path/to/Xcode.app [-o OUTPUT.tar]

Since the macOS 26 SDK, WebKit, JavaScriptCore and a few other frameworks
live in System/Cryptexes/OS/System/Library/Frameworks, and
System/Library/Frameworks only holds links to them. gen-sdk.py, from
Bitcoin Core, keeps usr/include, usr/lib and System/Library/Frameworks,
which is all Bitcoin Core needs: its tarball has the links and not what
they point at. Gerfaut shows its window in a WebKit view, so its build
needs that directory as well.

This script writes it the way gen-sdk.py writes the rest, so that the
same Xcode gives the same bytes on any machine: the same top directory,
entries in sorted order, every date zero, every owner root with no name,
modes reduced to 0755 and 0644, no Swift module and no module map. Both
tarballs unpack into the same tree, and the links then resolve.
"""

import argparse
import os
import pathlib
import plistlib
import tarfile

CRYPTEXES = "./System/Cryptexes/OS/System/Library/Frameworks"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("xcode_app", type=pathlib.Path)
    parser.add_argument("-o", dest="output", type=pathlib.Path)
    args = parser.parse_args()

    xcode_app = args.xcode_app.resolve()
    with xcode_app.joinpath("Contents/version.plist").open("rb") as handle:
        version = plistlib.load(handle)
    # The top directory gen-sdk.py uses, so the two tarballs share one tree.
    top = "Xcode-{}-{}-extracted-SDK-with-libcxx-headers".format(
        version["CFBundleShortVersionString"], version["ProductBuildVersion"])
    output = (args.output or pathlib.Path("Xcode-{}-{}-extracted-SDK-cryptexes.tar".format(
        version["CFBundleShortVersionString"], version["ProductBuildVersion"]))).resolve()
    sdk = xcode_app.joinpath("Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk")

    def normalise(info: tarfile.TarInfo):
        if info.name.endswith((".swiftmodule", ".modulemap")):
            return None
        if info.name.startswith("./"):
            info.name = str(pathlib.Path(top, info.name))
        if info.linkname.startswith("./"):
            info.linkname = str(pathlib.Path(top, info.linkname))
        info.mtime = 0
        info.uid, info.uname = 0, ""
        info.gid, info.gname = 0, ""
        info.mode = 0o755 if info.mode & 0o100 else 0o644
        return info

    old = os.getcwd()
    os.chdir(sdk)
    try:
        with output.open("wb") as handle:
            with tarfile.open(mode="w", fileobj=handle, format=tarfile.PAX_FORMAT) as tar:
                # tarfile walks each directory in sorted order.
                tar.add(CRYPTEXES, recursive=True, filter=normalise)
    finally:
        os.chdir(old)


if __name__ == "__main__":
    main()
