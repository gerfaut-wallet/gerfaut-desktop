#!/usr/bin/env python3
"""Compare two sets of Gerfaut desktop artefacts, and say where they differ.

Two uses:

  compare.py build-1 build-2
      Two rebuilds of the same commit. Both directories must hold the
      same files with the same bytes. Any difference is a bug.

  compare.py --published downloads rebuilt
      The files of a published release against your own rebuild. Every
      file you rebuilt must exist in the release with the same bytes.
      Files of the release you did not rebuild (other platforms,
      SHA256SUMS, signatures) are listed and left alone.

On a mismatch the tool opens the two files and reports what differs:
which member of a .deb, which header tag of an .rpm, the runtime or the
payload of an AppImage, the stub, the header or the packed file of a
Windows installer, and the build stage the difference comes from
when both sides carry a build-info directory. With --diffoscope DIR it
also writes a full diffoscope report per file, when diffoscope is
installed (the `tools` stage of reproducible/Dockerfile has it).

Exit code 0 means every compared file is identical. Needs only Python 3.

A published file comes from the network, so it is read as hostile: the
verdict rests on the hashes alone, the tool extracts nothing to disk,
and the limits below keep a crafted file from making it hang, fill the
memory or write to the terminal.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import lzma
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import zlib
from pathlib import Path

NOT_ARTEFACTS = {"SHA256SUMS"}
NOT_ARTEFACT_SUFFIXES = (".minisig", ".sig")

# Well above what a Gerfaut package needs. A larger file is still
# compared by hash, it is only not opened.
MAX_OPEN = 512 << 20
# What one decompression may produce.
MAX_UNPACKED = 512 << 20
# Windows loads no program with more sections than this.
MAX_PE_SECTIONS = 96
# An rpm header has a few dozen tags.
MAX_RPM_TAGS = 1 << 16
# Explanation lines printed per file.
MAX_LINES = 60
# Seconds an external tool may run on one file.
TOOL_TIMEOUT = 1800
CHUNK = 1 << 20

# What a hostile file cannot make this tool survive, for any reason.
BROKEN_FILE = (
    ValueError, IndexError, EOFError, OSError, struct.error, tarfile.TarError,
    zlib.error, lzma.LZMAError, subprocess.SubprocessError,
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def artefacts(directory: Path) -> dict[str, Path]:
    # A symbolic link is never an artefact, whatever it points at.
    return {
        p.name: p
        for p in sorted(directory.iterdir())
        if p.is_file()
        and not p.is_symlink()
        and p.name not in NOT_ARTEFACTS
        and not p.name.endswith(NOT_ARTEFACT_SUFFIXES)
    }


def printable(text: str) -> str:
    """Names and messages from a hostile file, safe to print: a control
    character could otherwise move the cursor or hide the verdict."""
    return "".join(c if c.isprintable() else f"\\x{ord(c):02x}" for c in text)


def head(path: Path, limit: int = 1 << 20) -> bytes:
    with path.open("rb") as handle:
        return handle.read(limit)


# --- generic -------------------------------------------------------------


def explain_bytes(a: bytes, b: bytes, what: str) -> list[str]:
    if a == b:
        return []
    lines = []
    if len(a) != len(b):
        lines.append(f"{what}: sizes differ, {len(a)} and {len(b)} bytes")
    shared = min(len(a), len(b))
    first, count = shared, 0
    view_a, view_b = memoryview(a), memoryview(b)
    for start in range(0, shared, CHUNK):
        end = min(start + CHUNK, shared)
        if view_a[start:end] == view_b[start:end]:
            continue
        # The two chunks XORed: a zero byte wherever they agree.
        xor = (int.from_bytes(view_a[start:end], "big") ^ int.from_bytes(view_b[start:end], "big")).to_bytes(
            end - start, "big")
        count += len(xor) - xor.count(0)
        if first == shared:
            first = start + len(xor) - len(xor.lstrip(b"\0"))
    lines.append(f"{what}: first difference at offset {first:#x}, {count} differing bytes in the shared length")
    return lines


# --- tar, used by .deb ---------------------------------------------------


def zstd_decompress(data: bytes) -> bytes:
    with tempfile.TemporaryFile() as source:
        source.write(data)
        source.seek(0)
        with subprocess.Popen(["zstd", "-dc"], stdin=source, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL) as zstd:
            out = zstd.stdout.read(MAX_UNPACKED + 1)
            zstd.kill()
    return out


def decompress(name: str, data: bytes) -> bytes:
    if name.endswith(".gz"):
        out = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(data, MAX_UNPACKED + 1)
    elif name.endswith(".xz"):
        out = lzma.LZMADecompressor().decompress(data, max_length=MAX_UNPACKED + 1)
    elif name.endswith(".zst"):
        out = zstd_decompress(data)
    else:
        return data
    if len(out) > MAX_UNPACKED:
        raise ValueError(f"{name} unpacks to more than {MAX_UNPACKED} bytes")
    return out


def tar_entries(data: bytes) -> list[tuple]:
    found = []
    # "r:" reads a plain tar: a second layer of compression is an error,
    # not something to unpack without a limit.
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as tar:
        for info in tar:
            digest = ""
            # A sparse entry declares a size its bytes do not hold.
            if info.isfile() and not info.issparse():
                digest = sha256(tar.extractfile(info).read())
            found.append(
                (info.name, info.type, oct(info.mode), info.uid, info.gid,
                 info.uname, info.gname, info.mtime, info.size, info.linkname, digest)
            )
    return found


TAR_FIELDS = ("name", "type", "mode", "uid", "gid", "uname", "gname", "mtime", "size", "linkname", "sha256")


def explain_tar(name: str, a: bytes, b: bytes) -> list[str]:
    raw_a, raw_b = decompress(name, a), decompress(name, b)
    if raw_a == raw_b:
        return [f"{name}: same tar once decompressed, so the compressor differs (version, level or header)"]
    ea, eb = tar_entries(raw_a), tar_entries(raw_b)
    lines = []
    names_a, names_b = [e[0] for e in ea], [e[0] for e in eb]
    if names_a != names_b:
        if sorted(names_a) == sorted(names_b):
            lines.append(f"{name}: same entries in a different order")
        else:
            for only in sorted(set(names_a) - set(names_b)):
                lines.append(f"{name}: {only} only in the first")
            for only in sorted(set(names_b) - set(names_a)):
                lines.append(f"{name}: {only} only in the second")
    by_b = {e[0]: e for e in eb}
    for entry in ea:
        other = by_b.get(entry[0])
        if other is None or other == entry:
            continue
        fields = [
            f"{TAR_FIELDS[i]} {entry[i]} -> {other[i]}"
            for i in range(1, len(TAR_FIELDS))
            if entry[i] != other[i]
        ]
        lines.append(f"{name}: {entry[0]}: " + ", ".join(fields))
    return lines or [f"{name}: tar framing differs (padding or header format), entries are the same"]


# --- .deb ----------------------------------------------------------------


def ar_members(data: bytes) -> list[tuple[str, dict, bytes]]:
    if data[:8] != b"!<arch>\n":
        raise ValueError("not an ar archive")
    members, offset = [], 8
    while offset + 60 <= len(data):
        header = data[offset:offset + 60]
        name = header[0:16].decode().strip().rstrip("/")
        meta = {
            "mtime": header[16:28].decode().strip(),
            "uid": header[28:34].decode().strip(),
            "gid": header[34:40].decode().strip(),
            "mode": header[40:48].decode().strip(),
        }
        size = int(header[48:58].decode().strip())
        if size < 0 or offset + 60 + size > len(data):
            raise ValueError(f"ar member {name!r} runs past the end of the file")
        body = data[offset + 60:offset + 60 + size]
        members.append((name, meta, body))
        offset += 60 + size + (size & 1)
    return members


def explain_deb(a: bytes, b: bytes) -> list[str]:
    ma, mb = ar_members(a), ar_members(b)
    lines = []
    if [m[0] for m in ma] != [m[0] for m in mb]:
        lines.append(f"ar members differ: {[m[0] for m in ma]} and {[m[0] for m in mb]}")
    by_b = {m[0]: m for m in mb}
    for name, meta, body in ma:
        if name not in by_b:
            continue
        _, other_meta, other_body = by_b[name]
        for key, value in meta.items():
            if value != other_meta[key]:
                lines.append(f"ar header of {name}: {key} {value} -> {other_meta[key]}")
        if body != other_body:
            if ".tar" in name:
                lines.extend(explain_tar(name, body, other_body))
            else:
                lines.extend(explain_bytes(body, other_body, name))
    return lines


# --- .rpm ----------------------------------------------------------------

RPM_TAGS = {
    1000: "NAME", 1001: "VERSION", 1002: "RELEASE", 1004: "SUMMARY", 1005: "DESCRIPTION",
    1006: "BUILDTIME", 1007: "BUILDHOST", 1009: "SIZE", 1010: "DISTRIBUTION", 1011: "VENDOR",
    1014: "LICENSE", 1015: "PACKAGER", 1016: "GROUP", 1020: "URL", 1021: "OS", 1022: "ARCH",
    1023: "PREIN", 1024: "POSTIN", 1025: "PREUN", 1026: "POSTUN", 1028: "FILESIZES",
    1030: "FILEMODES", 1033: "FILERDEVS", 1034: "FILEMTIMES", 1035: "FILEDIGESTS",
    1036: "FILELINKTOS", 1037: "FILEFLAGS", 1039: "FILEUSERNAME", 1040: "FILEGROUPNAME",
    1044: "SOURCERPM", 1045: "FILEVERIFYFLAGS", 1047: "PROVIDENAME", 1048: "REQUIREFLAGS",
    1049: "REQUIRENAME", 1050: "REQUIREVERSION", 1064: "RPMVERSION", 1095: "FILEDEVICES",
    1096: "FILEINODES", 1097: "FILELANGS", 1112: "PROVIDEFLAGS", 1113: "PROVIDEVERSION",
    1116: "DIRINDEXES", 1117: "BASENAMES", 1118: "DIRNAMES", 1122: "OPTFLAGS",
    1124: "PAYLOADFORMAT", 1125: "PAYLOADCOMPRESSOR", 1126: "PAYLOADFLAGS", 1132: "PLATFORM",
    1140: "FILECOLORS", 1141: "FILECLASS", 1142: "CLASSDICT", 1143: "FILEDEPENDSX",
    1144: "FILEDEPENDSN", 1145: "DEPENDSDICT", 1146: "SOURCEPKGID", 5011: "FILEDIGESTALGO",
    5062: "ENCODING", 5092: "PAYLOADDIGEST", 5093: "PAYLOADDIGESTALGO", 5097: "PAYLOADDIGESTALT",
}


def rpm_header(data: bytes, offset: int) -> tuple[dict[int, bytes], int]:
    magic, _, count, size = struct.unpack(">4s4sII", data[offset:offset + 16])
    if magic != b"\x8e\xad\xe8\x01":
        raise ValueError("bad rpm header magic")
    index = offset + 16
    store = index + 16 * count
    if count > MAX_RPM_TAGS or store + size > len(data):
        raise ValueError("rpm header runs past the end of the file")
    entries = []
    for i in range(count):
        tag, kind, where, number = struct.unpack(">IIII", data[index + 16 * i:index + 16 * i + 16])
        if where > size:
            raise ValueError(f"rpm tag {tag} points past its header")
        entries.append((tag, where))
    tags = {}
    bounds = sorted({where for _, where in entries} | {size})
    following = dict(zip(bounds, bounds[1:]))
    for tag, where in entries:
        tags[tag] = data[store + where:store + following.get(where, size)]
    return tags, store + size


def explain_rpm(a: bytes, b: bytes) -> list[str]:
    lines = []
    if a[:96] != b[:96]:
        lines.append("rpm lead differs")
    parts = []
    for data in (a, b):
        signature, end = rpm_header(data, 96)
        end += -end % 8
        header, payload_at = rpm_header(data, end)
        parts.append((signature, header, data[payload_at:]))
    for label, index in (("signature header", 0), ("header", 1)):
        first, second = parts[0][index], parts[1][index]
        for tag in sorted(set(first) | set(second)):
            if first.get(tag) != second.get(tag):
                name = RPM_TAGS.get(tag, str(tag))
                lines.append(f"rpm {label}: tag {name} differs")
    if parts[0][2] != parts[1][2]:
        lines.append("rpm payload (the compressed cpio archive) differs")
    return lines


# --- .AppImage -----------------------------------------------------------


def elf_size(data: bytes) -> int:
    """Where the ELF runtime ends and the squashfs payload starts."""
    if data[:4] != b"\x7fELF" or data[4] != 2:
        raise ValueError("not a 64-bit ELF file")
    shoff = struct.unpack_from("<Q", data, 0x28)[0]
    shentsize, shnum = struct.unpack_from("<HH", data, 0x3A)
    return shoff + shentsize * shnum


def squashfs_listing(path: Path, offset: int) -> list[str] | None:
    if shutil.which("unsquashfs") is None:
        return None
    done = subprocess.run(
        ["unsquashfs", "-o", str(offset), "-lls", str(path)],
        capture_output=True, text=True, errors="replace", check=False, timeout=TOOL_TIMEOUT,
    )
    return done.stdout.splitlines()


def explain_appimage(a: bytes, b: bytes, path_a: Path, path_b: Path) -> list[str]:
    lines = []
    size_a, size_b = elf_size(a), elf_size(b)
    if a[:size_a] != b[:size_b]:
        lines.append(f"AppImage runtime differs: {sha256(a[:size_a])} and {sha256(b[:size_b])}")
    pay_a, pay_b = a[size_a:], b[size_b:]
    if pay_a != pay_b:
        time_a, time_b = struct.unpack_from("<I", pay_a, 8)[0], struct.unpack_from("<I", pay_b, 8)[0]
        if time_a != time_b:
            lines.append(f"squashfs creation time differs: {time_a} and {time_b}")
        list_a, list_b = squashfs_listing(path_a, size_a), squashfs_listing(path_b, size_b)
        if list_a is None:
            lines.append("squashfs payload differs (install squashfs-tools for a listing)")
        elif list_a != list_b:
            changed = sorted(set(list_a) ^ set(list_b))
            lines.append(f"squashfs listing differs on {len(changed)} lines, first ones:")
            lines.extend("    " + line for line in changed[:20])
        else:
            lines.append("squashfs listing is the same: file contents, order or compression differ")
    return lines


# --- Windows: PE files and NSIS installers -------------------------------


def pe_layout(data: bytes) -> tuple[dict, list[tuple[str, int, int]]]:
    """The header fields a build can leak into, and (name, offset, size) per section."""
    if data[:2] != b"MZ":
        raise ValueError("not a PE file")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("bad PE signature")
    count, stamp = struct.unpack_from("<HI", data, pe + 6)
    if count > MAX_PE_SECTIONS:
        raise ValueError(f"{count} PE sections, more than Windows loads")
    optional_size = struct.unpack_from("<H", data, pe + 20)[0]
    optional = pe + 24
    fields = {
        "TimeDateStamp": stamp,
        "CheckSum": struct.unpack_from("<I", data, optional + 64)[0],
    }
    sections = []
    table = optional + optional_size
    for i in range(count):
        entry = table + 40 * i
        name = data[entry:entry + 8].rstrip(b"\0").decode("ascii", "replace")
        size, offset = struct.unpack_from("<II", data, entry + 16)
        sections.append((name, offset, size))
    return fields, sections


def pe_end(data: bytes) -> int:
    """Where the image ends and whatever was appended to it starts."""
    _, sections = pe_layout(data)
    return max((offset + size for _, offset, size in sections), default=0)


def explain_pe(a: bytes, b: bytes, what: str) -> list[str]:
    fields_a, sections_a = pe_layout(a)
    fields_b, sections_b = pe_layout(b)
    lines = []
    for key, value in fields_a.items():
        if value != fields_b[key]:
            lines.append(f"{what}: PE header {key} differs: {value:#010x} and {fields_b[key]:#010x}")
    if [s[0] for s in sections_a] != [s[0] for s in sections_b]:
        lines.append(f"{what}: PE sections differ: {[s[0] for s in sections_a]} and {[s[0] for s in sections_b]}")
        return lines
    for (name, off_a, size_a), (_, off_b, size_b) in zip(sections_a, sections_b):
        part_a, part_b = a[off_a:off_a + size_a], b[off_b:off_b + size_b]
        if part_a != part_b:
            lines.extend(explain_bytes(part_a, part_b, f"{what}: section {name}"))
    return lines or explain_bytes(a, b, f"{what}: outside the header fields and the sections")


NSIS_MAGIC = b"\xef\xbe\xad\xdeNullsoftInst"


def nsis_parts(data: bytes) -> tuple[bytes, bytes, bytes]:
    """The stub, the 28-byte first header and the compressed payload."""
    at = data.find(NSIS_MAGIC, pe_end(data) - 4) - 4
    if at < 0:
        raise ValueError("no NSIS header after the PE image")
    return data[:at], data[at:at + 28], data[at + 28:]


def nsis_unpack(payload: bytes) -> bytes:
    """A solid LZMA payload: five bytes of properties, then the raw stream."""
    properties, dictionary = struct.unpack_from("<BI", payload, 0)
    # The decoder allocates the whole dictionary up front.
    if dictionary > MAX_UNPACKED:
        raise ValueError(f"an LZMA dictionary of {dictionary} bytes")
    options = {
        "id": lzma.FILTER_LZMA1, "dict_size": dictionary,
        "lc": properties % 9, "lp": properties // 9 % 5, "pb": properties // 45,
    }
    raw = lzma.LZMADecompressor(lzma.FORMAT_RAW, filters=[options]).decompress(
        payload[5:], max_length=MAX_UNPACKED + 1)
    if len(raw) > MAX_UNPACKED:
        raise ValueError(f"the NSIS payload unpacks to more than {MAX_UNPACKED} bytes")
    return raw


def nsis_blocks(raw: bytes) -> list[bytes]:
    """The installer header first, then one block per packed file."""
    blocks, at = [], 0
    while at + 4 <= len(raw):
        size = struct.unpack_from("<I", raw, at)[0] & 0x7FFFFFFF
        blocks.append(raw[at + 4:at + 4 + size])
        at += 4 + size
    return blocks


def explain_nsis(a: bytes, b: bytes) -> list[str]:
    stub_a, first_a, pay_a = nsis_parts(a)
    stub_b, first_b, pay_b = nsis_parts(b)
    lines = []
    if stub_a != stub_b:
        lines.append("NSIS stub differs: not the same nsis package, or not the same icon and version resource")
        lines.extend(explain_pe(stub_a, stub_b, "stub"))
    if first_a != first_b:
        lines.append("NSIS first header differs: the flags, or the size of what follows")
    if pay_a == pay_b:
        return lines
    try:
        raw_a, raw_b = nsis_unpack(pay_a), nsis_unpack(pay_b)
    except (lzma.LZMAError, EOFError, ValueError, struct.error) as error:
        return lines + [f"NSIS payload differs and could not be unpacked ({error})"]
    if raw_a == raw_b:
        return lines + ["NSIS payload: same content once unpacked, so the compressor differs"]
    blocks_a, blocks_b = nsis_blocks(raw_a), nsis_blocks(raw_b)
    if len(blocks_a) != len(blocks_b):
        lines.append(f"NSIS payload: {len(blocks_a)} and {len(blocks_b)} blocks")
    for index, (block_a, block_b) in enumerate(zip(blocks_a, blocks_b)):
        if block_a == block_b:
            continue
        if index == 0:
            lines.extend(explain_bytes(block_a, block_b, "NSIS installer header (script, strings, file dates)"))
        elif block_a[:2] == b"MZ" and block_b[:2] == b"MZ":
            lines.extend(explain_pe(block_a, block_b, f"packed file {index} (a PE file of {len(block_a)} bytes)"))
        else:
            lines.extend(explain_bytes(block_a, block_b, f"packed file {index}"))
    return lines


# --- driver --------------------------------------------------------------


def explain(path_a: Path, path_b: Path) -> list[str]:
    size_a, size_b = path_a.stat().st_size, path_b.stat().st_size
    if max(size_a, size_b) > MAX_OPEN:
        return [f"{size_a} and {size_b} bytes: too large to open, compared by hash only"]
    a, b = path_a.read_bytes(), path_b.read_bytes()
    try:
        if path_a.suffix == ".deb":
            return explain_deb(a, b)
        if path_a.suffix == ".rpm":
            return explain_rpm(a, b)
        if path_a.suffix == ".AppImage":
            return explain_appimage(a, b, path_a, path_b)
        if path_a.suffix == ".exe":
            return explain_nsis(a, b)
    except BROKEN_FILE as error:
        return [f"could not open the file as a {path_a.suffix} ({error})"] + explain_bytes(a, b, path_a.name)
    return explain_bytes(a, b, path_a.name)


def explain_stage(dir_a: Path, dir_b: Path) -> list[str]:
    """Which build stage a difference comes from, when build-info is there."""
    info_a, info_b = dir_a / "build-info", dir_b / "build-info"
    if not (info_a.is_dir() and info_b.is_dir()):
        return []
    lines = []
    for name, meaning in (
        ("sources", "the two builds do not come from the same commits"),
        ("image-packages", "the two images do not hold the same packages: different toolchain"),
        ("frontend.sha256", "the frontend (Vite output) differs"),
        ("binary.sha256", "the compiled binary differs"),
    ):
        fa, fb = info_a / name, info_b / name
        if fa.is_file() and fb.is_file() and head(fa) != head(fb):
            lines.append(meaning)
    return lines or ["toolchain, frontend and binary are the same: the difference comes from packaging"]


def run_diffoscope(path_a: Path, path_b: Path, report_dir: Path) -> str | None:
    if shutil.which("diffoscope") is None:
        return None
    report_dir.mkdir(parents=True, exist_ok=True)
    report = report_dir / f"{path_a.name}.diffoscope.txt"
    try:
        subprocess.run(
            ["diffoscope", "--text", str(report), "--max-report-size", "2000000", str(path_a), str(path_b)],
            check=False, timeout=TOOL_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return f"{report} (cut short after {TOOL_TIMEOUT} seconds)"
    return str(report)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("first", type=Path, help="a directory of artefacts (with --published: the downloaded release)")
    parser.add_argument("second", type=Path, help="a directory of artefacts (with --published: your rebuild)")
    parser.add_argument("--published", action="store_true", help="the first directory is a published release")
    parser.add_argument("--diffoscope", type=Path, metavar="DIR", help="write a diffoscope report per differing file")
    args = parser.parse_args()

    for directory in (args.first, args.second):
        if not directory.is_dir():
            parser.error(f"not a directory: {directory}")
    set_a, set_b = artefacts(args.first), artefacts(args.second)
    if not set_b:
        print(f"no artefact in {args.second}")
        return 1

    failed = False
    for name in sorted(set(set_a) | set(set_b)):
        shown = printable(name)
        if name not in set_b:
            if args.published:
                print(f"  not rebuilt  {shown}")
            else:
                print(f"  MISSING      {shown} (only in {args.first})")
                failed = True
            continue
        if name not in set_a:
            print(f"  MISSING      {shown} (only in {args.second})")
            failed = True
            continue
        hash_a, hash_b = file_sha256(set_a[name]), file_sha256(set_b[name])
        if hash_a == hash_b:
            print(f"  identical    {shown}  {hash_a}")
            continue
        failed = True
        print(f"  DIFFERENT    {shown}")
        print(f"      {hash_a}  {printable(str(set_a[name]))}")
        print(f"      {hash_b}  {printable(str(set_b[name]))}")
        lines = explain(set_a[name], set_b[name])
        for line in lines[:MAX_LINES]:
            print(f"      {printable(line)}")
        if len(lines) > MAX_LINES:
            print(f"      and {len(lines) - MAX_LINES} more lines")
        if args.diffoscope:
            report = run_diffoscope(set_a[name], set_b[name], args.diffoscope)
            print(f"      full report: {printable(report)}" if report else "      diffoscope is not installed, no full report")

    # Said whatever the hashes are: two unpinned builds can match each
    # other and still be nothing a release should be compared with.
    for directory in (args.first, args.second):
        sources = directory / "build-info" / "sources"
        if sources.is_file() and b"NOT A RELEASE BUILD" in head(sources):
            print(f"  warning: {directory} was built against a core other than the pinned one")

    if failed:
        for line in explain_stage(args.first, args.second):
            print(f"  note: {line}")
        print("RESULT: the two sets differ")
        return 1
    print("RESULT: identical, byte for byte")
    return 0


if __name__ == "__main__":
    sys.exit(main())
