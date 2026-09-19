#!/usr/bin/env python3
"""Make the .rpm written by Tauri's bundler independent of the clock.

    rpm-normalise.py <package.rpm> <epoch>

Tauri builds the package with the rpm-rs library, which stamps the wall
clock into two header tags and offers the bundler no way around it:
BUILDTIME, and FILEMTIMES, the modification time of every packaged file.
Everything else in the file is already a pure function of its content.

This tool overwrites those two tags with <epoch> and recomputes the
digests that cover the header. Both tags are arrays of 32-bit integers,
so the file keeps its size and every other byte stays where Tauri put
it: same name, same dependencies, same file list, same payload.

Layout of an rpm file: a 96-byte lead, the signature header (padded to
8 bytes), the header, then the compressed payload. The signature header
carries digests of what follows it.
"""

from __future__ import annotations

import hashlib
import struct
import sys

HEADER_MAGIC = b"\x8e\xad\xe8\x01"
INT32 = 4

# Main header.
TAG_BUILDTIME = 1006
TAG_FILEMTIMES = 1034
# Signature header.
SIG_SHA1 = 269      # hex digest of the header
SIG_SHA256 = 273    # hex digest of the header
SIG_MD5 = 1004      # binary digest of the header and the payload
# Tags that would mean the package is signed: a signature covers the
# header, and rewriting the header would silently break it.
SIG_SIGNATURES = {267: "DSA", 268: "RSA", 1002: "PGP", 1005: "GPG"}


class Header:
    def __init__(self, data: bytearray, offset: int):
        magic, _, count, size = struct.unpack_from(">4s4sII", data, offset)
        if magic != HEADER_MAGIC:
            raise ValueError(f"no rpm header at offset {offset}")
        self.start = offset
        self.store = offset + 16 + 16 * count
        self.end = self.store + size
        self.entries = {}
        for i in range(count):
            tag, kind, where, number = struct.unpack_from(">IIII", data, offset + 16 + 16 * i)
            self.entries[tag] = (kind, self.store + where, number)


def set_int32(data: bytearray, header: Header, tag: int, value: int) -> None:
    if tag not in header.entries:
        return
    kind, where, number = header.entries[tag]
    if kind != INT32:
        raise ValueError(f"tag {tag} is not a 32-bit integer array")
    struct.pack_into(f">{number}I", data, where, *([value] * number))


def set_bytes(data: bytearray, header: Header, tag: int, value: bytes) -> None:
    if tag not in header.entries:
        return
    _, where, _ = header.entries[tag]
    data[where:where + len(value)] = value


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    path, epoch = sys.argv[1], int(sys.argv[2])
    if not 0 <= epoch < 2**32:
        raise ValueError("the epoch does not fit a 32-bit rpm tag")

    with open(path, "rb") as handle:
        data = bytearray(handle.read())
    size = len(data)

    signature = Header(data, 96)
    for tag, name in SIG_SIGNATURES.items():
        if tag in signature.entries:
            raise ValueError(f"the package carries a {name} signature, refusing to rewrite its header")
    header = Header(data, signature.end + (-signature.end % 8))

    set_int32(data, header, TAG_BUILDTIME, epoch)
    set_int32(data, header, TAG_FILEMTIMES, epoch)

    header_bytes = bytes(data[header.start:header.end])
    # The hex digests are stored as NUL-terminated strings of fixed length.
    set_bytes(data, signature, SIG_SHA1, hashlib.sha1(header_bytes).hexdigest().encode())
    set_bytes(data, signature, SIG_SHA256, hashlib.sha256(header_bytes).hexdigest().encode())
    set_bytes(data, signature, SIG_MD5, hashlib.md5(bytes(data[header.start:])).digest())

    if len(data) != size:
        raise AssertionError("the file changed size")
    with open(path, "wb") as handle:
        handle.write(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
