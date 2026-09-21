#!/usr/bin/env python3
"""Write the Info.plist of Gerfaut.app, byte for byte as Tauri's bundler does.

    info-plist.py <src-tauri directory> <Info.plist to write>

Tauri's macOS bundler only runs on a Mac, so the recipe writes this file
itself. The keys, their order and their values follow create_info_plist()
in tauri-bundler/src/bundle/macos/app.rs (tauri-cli 2.11.4), and the text
follows the XML writer of the plist crate it uses: a tab per level, five
characters escaped, no newline at the end.

The script handles the configuration Gerfaut has and nothing more. A
setting that would add a key, a file or a signature option makes it stop,
so a change of tauri.conf.json cannot silently give a bundle that differs
from Tauri's. The macos-reference job of the Reproducible build workflow
compares the result with a bundle Tauri makes on a Mac.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# tauri-bundler/src/bundle/category.rs, the categories Gerfaut could use.
CATEGORIES = {
    "Finance": "public.app-category.finance",
}
# tauri-utils/src/config.rs, macos_minimum_system_version().
DEFAULT_MINIMUM_SYSTEM_VERSION = "10.13"


def fail(message: str) -> None:
    sys.exit(f"info-plist.py: {message}")


def escape(text: str) -> str:
    # quick-xml's escape(): the five characters XML reserves.
    for char, entity in (("&", "&amp;"), ("<", "&lt;"), (">", "&gt;"), ("'", "&apos;"), ('"', "&quot;")):
        text = text.replace(char, entity)
    return text


def binary_name(tauri: Path, config: dict) -> str:
    if "mainBinaryName" in config:
        fail("mainBinaryName is not handled")
    manifest = (tauri / "Cargo.toml").read_text(encoding="utf-8")
    if re.search(r"^\[\[bin\]\]", manifest, re.M) or re.search(r"^default-run", manifest, re.M):
        fail("a [[bin]] section or default-run in Cargo.toml is not handled")
    package = re.search(r"^\[package\]\s*\nname = \"([A-Za-z0-9_-]+)\"$", manifest, re.M)
    if not package:
        fail("no package name at the top of Cargo.toml")
    return package.group(1)


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: info-plist.py <src-tauri directory> <Info.plist to write>")
    tauri, output = Path(sys.argv[1]), Path(sys.argv[2])
    config = json.loads((tauri / "tauri.conf.json").read_text(encoding="utf-8"))
    bundle = config.get("bundle", {})

    for key in ("macOS", "fileAssociations", "resources", "externalBin"):
        if key in bundle:
            fail(f"bundle.{key} is not handled")
    if "deep-link" in config.get("plugins", {}):
        fail("the deep-link plugin adds CFBundleURLTypes, which is not handled")
    if (tauri / "Info.plist").exists():
        fail("src-tauri/Info.plist would be merged into the plist, which is not handled")
    for name in ("tauri.macos.conf.json", "tauri.macos.conf.json5", "Tauri.macos.toml"):
        if (tauri / name).exists():
            fail(f"{name} would be merged into the configuration, which is not handled")
    icons = bundle.get("icon", [])
    if any(icon.endswith((".car", ".icon")) for icon in icons):
        fail("an Assets.car icon is not handled")
    if not any(icon.endswith(".icns") for icon in icons):
        fail("no .icns in bundle.icon")
    version = config.get("version", "")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        fail(f"version {version!r} is not a plain x.y.z version")
    category = bundle.get("category")
    if category not in CATEGORIES:
        fail(f"category {category!r} is not in the table")
    product = config["productName"]

    entries = [
        ("CFBundleDevelopmentRegion", "English"),
        ("CFBundleDisplayName", product),
        ("CFBundleExecutable", binary_name(tauri, config)),
        ("CFBundleIdentifier", config["identifier"]),
        ("CFBundleInfoDictionaryVersion", "6.0"),
        ("CFBundleName", product),
        ("CFBundlePackageType", "APPL"),
        ("CFBundleShortVersionString", version),
        ("CFBundleVersion", version),
        ("CSResourcesFileMapped", True),
        ("LSApplicationCategoryType", CATEGORIES[category]),
        ("LSMinimumSystemVersion", DEFAULT_MINIMUM_SYSTEM_VERSION),
        # The first .icns of the list, copied under its own name.
        ("CFBundleIconFile", Path(next(i for i in icons if i.endswith(".icns"))).name),
        ("LSRequiresCarbon", True),
        ("NSHighResolutionCapable", True),
    ]
    if "copyright" in bundle:
        entries.append(("NSHumanReadableCopyright", bundle["copyright"]))

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        "<dict>",
    ]
    for key, value in entries:
        lines.append(f"\t<key>{escape(key)}</key>")
        lines.append("\t<true/>" if value is True else f"\t<string>{escape(value)}</string>")
    lines += ["</dict>", "</plist>"]
    output.write_bytes("\n".join(lines).encode("utf-8"))


if __name__ == "__main__":
    main()
