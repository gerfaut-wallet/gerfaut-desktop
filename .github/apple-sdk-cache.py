#!/usr/bin/env python3
"""Seal the Apple SDK tarballs for the Actions cache, and open them again.

    apple-sdk-cache.py key-id       the id of the key, for the cache key
    apple-sdk-cache.py seal DIR     DIR/<name>.tar -> DIR/<name>.tar.sealed
    apple-sdk-cache.py open DIR     DIR/<name>.tar.sealed -> DIR/<name>.tar

The key comes from the environment, APPLE_SDK_CACHE_KEY, 64 hexadecimal
digits: the repository secret of the same name, which apple-sdk.yml and
container-build.yml receive and the run of a pull request from a fork
never does.

The Apple SDK is not free software, and anyone who can start a workflow
run can read the Actions cache of the repository: in a public one, that
includes a pull request from a fork. So a tarball never goes into the
cache in the clear. `seal` compresses it, encrypts it with AES-256-CBC
and a random IV, and appends an HMAC-SHA256 of the file name, the IV and
the ciphertext, under two keys derived from the secret. `open` checks
that HMAC before it decrypts anything: an entry sealed under another key,
renamed or changed in any way is refused.

Opening only proves that a run which held the secret sealed the entry.
The build still checks each tarball against the hash in
reproducible/macos/apple-sdk.sha256.

The cipher is OpenSSL's `enc`, the one tool both the macOS and the Linux
runners have (LibreSSL on the Mac); the rest is Python's standard library.
"""

import gzip
import hashlib
import hmac
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MAGIC = b"gerfaut apple-sdk cache, sealed, 1\n"
IV_SIZE = 16
TAG_SIZE = 32
CHUNK = 1 << 20


def fail(message: str) -> None:
    sys.exit(f"apple-sdk-cache: {message}")


def keys() -> tuple:
    """The encryption key, the authentication key and the id of the pair."""
    value = os.environ.get("APPLE_SDK_CACHE_KEY", "")
    try:
        secret = bytes.fromhex(value)
    except ValueError:
        secret = b""
    if len(secret) != 32:
        fail("APPLE_SDK_CACHE_KEY is not set to 64 hexadecimal digits")

    def derive(label: bytes) -> bytes:
        return hmac.new(secret, b"gerfaut apple-sdk cache " + label, hashlib.sha256).digest()

    return derive(b"encryption"), derive(b"authentication"), derive(b"key id").hex()[:16]


def openssl(mode: str, key: bytes, iv: bytes, source: Path, target: Path) -> None:
    subprocess.run(
        ["openssl", "enc", mode, "-aes-256-cbc", "-K", key.hex(), "-iv", iv.hex(),
         "-in", str(source), "-out", str(target)],
        check=True,
    )


def authenticator(key: bytes, name: str, iv: bytes):
    return hmac.new(key, MAGIC + name.encode() + b"\0" + iv, hashlib.sha256)


def seal(directory: Path) -> None:
    encryption, authentication, _ = keys()
    tarballs = sorted(directory.glob("*.tar"))
    if not tarballs:
        fail(f"no tarball in {directory}")
    for tarball in tarballs:
        iv = secrets.token_bytes(IV_SIZE)
        with tempfile.TemporaryDirectory(dir=directory) as work:
            packed, cipher = Path(work, "packed"), Path(work, "cipher")
            with tarball.open("rb") as source, gzip.open(packed, "wb", compresslevel=6) as target:
                shutil.copyfileobj(source, target, CHUNK)
            openssl("-e", encryption, iv, packed, cipher)
            tag = authenticator(authentication, tarball.name, iv)
            with cipher.open("rb") as source, open(f"{tarball}.sealed", "xb") as target:
                target.write(MAGIC + iv)
                for block in iter(lambda: source.read(CHUNK), b""):
                    tag.update(block)
                    target.write(block)
                target.write(tag.digest())
        tarball.unlink()


def open_sealed(directory: Path) -> None:
    encryption, authentication, _ = keys()
    sealed_files = sorted(directory.glob("*.tar.sealed"))
    if not sealed_files:
        fail(f"no sealed tarball in {directory}")
    for sealed in sealed_files:
        name = sealed.name[:-len(".sealed")]
        left = sealed.stat().st_size - len(MAGIC) - IV_SIZE - TAG_SIZE
        if left <= 0 or left % 16:
            fail(f"{sealed.name} is not a sealed tarball")
        with sealed.open("rb") as source, tempfile.TemporaryDirectory(dir=directory) as work:
            packed, cipher = Path(work, "packed"), Path(work, "cipher")
            if source.read(len(MAGIC)) != MAGIC:
                fail(f"{sealed.name} is not a sealed tarball")
            iv = source.read(IV_SIZE)
            tag = authenticator(authentication, name, iv)
            with cipher.open("wb") as target:
                while left:
                    block = source.read(min(CHUNK, left))
                    if not block:
                        fail(f"{sealed.name} is cut short")
                    tag.update(block)
                    target.write(block)
                    left -= len(block)
            # Nothing is decrypted before this check.
            if not hmac.compare_digest(tag.digest(), source.read(TAG_SIZE)):
                fail(f"{sealed.name} was not sealed with this key, or was changed since")
            openssl("-d", encryption, iv, cipher, packed)
            with gzip.open(packed, "rb") as unpacked, open(directory / name, "xb") as target:
                shutil.copyfileobj(unpacked, target, CHUNK)
        sealed.unlink()


def main() -> None:
    if sys.argv[1:] == ["key-id"]:
        print(keys()[2])
    elif len(sys.argv) == 3 and sys.argv[1] in ("seal", "open"):
        directory = Path(sys.argv[2])
        if not directory.is_dir():
            fail(f"not a directory: {directory}")
        (seal if sys.argv[1] == "seal" else open_sealed)(directory)
    else:
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
