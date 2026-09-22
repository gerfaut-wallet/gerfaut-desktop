# Reproducible builds

The Linux packages of Gerfaut (`.deb`, `.rpm` and `.AppImage`), its Windows installer (`Gerfaut_<version>_x64-setup.exe`) and its macOS application (`Gerfaut_<version>_universal.zip`) are built inside a Linux container where every input is pinned. Two builds of the same commit give the same files, byte for byte, whatever the machine, the day or the number of processor cores.

This means you do not have to trust the machine that produced the file you downloaded. Rebuild the tag yourself, run `sha256sum` on your file and on the published one, and the two hashes are equal.

Nothing has to be set aside for the comparison. A Linux package carries no signature inside it, and the Windows installer has no Authenticode signature today. The macOS application has an ad hoc signature, made of hashes only, which the build writes itself. The author's [minisign](https://jedisct1.github.io/minisign/) signature covers `SHA256SUMS` and lives in a separate file, `SHA256SUMS.minisig`.

## Scope

This page covers the three Linux packages and the Windows installer, all for x86_64, and the macOS application, for Apple silicon and Intel. The Windows installer and the macOS application are built on Linux too, so you need no Windows machine and no Mac to check them. There is no `.msi`: it can only be made on Windows, so it could not be held to this promise. There is no `.dmg` either, see "The zip" below.

The `Release` workflow builds the files of every release with this recipe, twice, and publishes nothing unless the two builds match, so the files on the releases page are the ones this page tells you to rebuild. A release built this way says so in its notes, under "Rebuild it yourself". A release that does not say so was built on a hosted runner, outside the container, and its files will not match a rebuild. Its tag may not even carry the `reproducible` directory.

## What you need

- A Linux machine, or any machine that runs Linux containers
- Docker or Podman
- git and curl
- About 8 GB of free disk: 2.6 GB for the image, 0.6 GB of downloads, close to 4 GB while a build runs
- 8 GB of RAM for the container engine
- About 20 minutes for a first build on a recent laptop, image included, then 12 to 14 minutes per build

You need no Rust, no Node and no Python on the host. Everything runs in the container.

The Windows installer needs a little less: 2.4 GB for its image, 2 GB of downloads, and 8 to 10 minutes per build. It also needs you to accept a licence from Microsoft, see "Verify the Windows installer" below.

The macOS application needs 2.7 GB for its image, which downloads 1.9 GB of LLVM once while it is built, then 0.65 GB of downloads and about 20 minutes per build, since the application is compiled twice. It also needs the Apple SDK, which you make yourself from Xcode, see "Verify the macOS application" below.

## Verify a published release

```sh
git clone https://github.com/gerfaut-wallet/gerfaut-desktop
gerfaut-desktop/reproducible/verify.sh v<version>
```

Replace `v<version>` with the tag of a release whose notes say it was built with this recipe. The script works in a new temporary directory and does five things:

1. It clones `gerfaut-desktop` at the tag. From there on, the recipe that runs is the one the tag carries.
2. It reads `.github/gerfaut-core.rev`, the exact commit of the Rust core this tag was built against, and clones `gerfaut-core` at that commit.
3. It builds the pinned image and the three packages.
4. It downloads the same three files from the releases page.
5. It compares them and prints a verdict.

A release that matches ends like this:

```
  identical    Gerfaut-<version>-1.x86_64.rpm  <sha256>
  identical    Gerfaut_<version>_amd64.AppImage  <sha256>
  identical    Gerfaut_<version>_amd64.deb  <sha256>
RESULT: identical, byte for byte
==> VERIFIED: the published linux files of v<version> are the ones this source builds
```

With Podman, set `GERFAUT_ENGINE=podman` in front of the command. The script picks Docker first when both are installed. The scripts call nothing Docker-specific, but so far they have only been run with Docker. If Podman gives you a different result, please report it.

You can also do the last step by hand. The rebuilt files and their `SHA256SUMS` are in the `rebuilt` directory the script names at the start. Compare that list with the signed `SHA256SUMS` of the release: the three lines must be the same.

## Verify the Windows installer

```sh
git clone https://github.com/gerfaut-wallet/gerfaut-desktop
gerfaut-desktop/reproducible/verify.sh v<version> --target windows --accept-microsoft-license
```

The steps are the same as above, on a Linux machine, with one file to compare: `Gerfaut_<version>_x64-setup.exe`.

`--accept-microsoft-license` is not optional, and the script never sets it for you. A Windows program links against the Microsoft C runtime and the Windows SDK. These are not free software, and Gerfaut does not redistribute them: they are in no repository and in no container image. Your own build downloads them from Microsoft's servers to your machine, about 310 MB. By passing the flag you state that you have read [Microsoft's licence terms](https://go.microsoft.com/fwlink/?LinkId=2086102) and that you accept them. Without the flag, the build stops before it downloads anything from Microsoft and prints this link.

The downloaded files stay in the cache volume on your machine. Do not publish that volume, or an image made from it.

## Verify the macOS application

The macOS application is linked against the Apple SDK: the headers and the library stubs that come with Xcode. The build cannot download it for you, so you make it once, from Xcode, and hand it to the build.

### Make the Apple SDK

1. Download Xcode 26.1.1 from Apple. You need an Apple ID, which is free. Sign in on [Apple's download page](https://developer.apple.com/download/all/?q=Xcode%2026.1.1) and take `Xcode_26.1.1_Apple_silicon.xip`.

2. Check the file you got:

   ```sh
   sha256sum Xcode_26.1.1_Apple_silicon.xip
   ```

   The hash must be `f4c65b01e2807372b61553c71036dbfef492d7c79d4c380a5afb61aa1018e555`.

3. Make the SDK from it:

   ```sh
   gerfaut-desktop/reproducible/make-apple-sdk.sh Xcode_26.1.1_Apple_silicon.xip
   ```

   The script checks the `.xip` again, then works in the pinned image, without network. It unpacks the part of Xcode that holds the SDK with `extract_xcode.py` and `cpio`, and writes two tarballs into `apple-sdk/`. It then checks their hashes:

   ```
   9600fa93644df674ee916b5e2c8a6ba8dacf631996a65dc922d003b98b5ea3b1  Xcode-26.1.1-17B100-extracted-SDK-with-libcxx-headers.tar
   fb8a938117fc12e5982d77c241f3168bdab9441cecacff51d5de277e66f337f3  Xcode-26.1.1-17B100-extracted-SDK-cryptexes.tar
   ```

The first tarball is the SDK Bitcoin Core builds its macOS releases with: the same file, with the same hash, written by the same `gen-sdk.py`. That script and `extract_xcode.py` come from the Bitcoin Core project and are copied byte for byte in `reproducible/macos/`, with the commit each one comes from.

The second tarball exists because of a change in the macOS 26 SDK. WebKit, JavaScriptCore and a few other frameworks now live in a separate folder, `System/Cryptexes`, and the usual folder only holds links to them. `gen-sdk.py` leaves that folder out, which suits Bitcoin Core. Gerfaut shows its window in a WebKit view, so it needs it. `reproducible/macos/gen-sdk-cryptexes.py` writes that folder the way `gen-sdk.py` writes the rest, into the same tree.

On a Mac with Xcode 26.1.1, the two scripts write the same two files: run `python3 reproducible/macos/gen-sdk.py /path/to/Xcode.app` and `python3 reproducible/macos/gen-sdk-cryptexes.py /path/to/Xcode.app`.

### Rebuild and compare

```sh
gerfaut-desktop/reproducible/verify.sh v<version> --target macos --macos-sdk apple-sdk
```

The steps are the same as for Linux, with one file to compare: `Gerfaut_<version>_universal.zip`.

The build refuses a tarball whose hash is not the one in `reproducible/macos/apple-sdk.sha256`. It mounts the two files read-only into the container that compiles, the one with no network. The container that downloads never sees them.

### Apple's licence

The SDK belongs to Apple and it is not free software. Bitcoin Core states its position this way: "These SDKs are free to download, but not redistributable." Gerfaut takes the same position. The SDK is in no repository and in no container image, nobody publishes it, and only its hashes are published. Each person who rebuilds makes their own copy from Xcode. Keep yours to yourself.

The Xcode licence also limits the use of the SDK to computers made by Apple. A build on Linux does not follow that clause. Bitcoin Core and Tor Browser have built their macOS releases on Linux this way for years, and Gerfaut accepts the same risk. Read the licence and decide for yourself before you rebuild.

## Build without comparing

From a checkout of this repository, with `gerfaut-core` cloned next to it:

```sh
reproducible/build.sh linux
reproducible/build.sh windows --accept-microsoft-license
reproducible/build.sh macos --macos-sdk apple-sdk
```

The packages land in `reproducible/out/linux/`, the installer in `reproducible/out/windows/` and the zip in `reproducible/out/macos/`, next to a `SHA256SUMS` file and a `build-info` directory. The script builds the commit at `HEAD`, never the working tree, and it always uses the `gerfaut-core` commit named in `.github/gerfaut-core.rev`.

To check that the build is stable on your own machine, ask for two:

```sh
reproducible/build.sh linux --twice
reproducible/build.sh windows --twice --accept-microsoft-license
reproducible/build.sh macos --twice --macos-sdk apple-sdk
```

It builds twice, in two separate containers, and fails if a single byte differs. The `Reproducible build` and `Release` workflows go one step further: they build each target on two separate runners and compare the two.

To compare two sets of files you already have:

```sh
reproducible/compare.sh build-1 build-2
reproducible/compare.sh --published downloads rebuilt
```

## How a build runs

`build.sh` exports both repositories with `git archive` and hands the two archives to the container. They are unpacked inside it, at `/build`. File modes, dates and line endings come from git, and the host file system has no say. This matters more than it seems: Tauri's `.rpm` bundler copies the mode and the date of each icon into the package.

The build then runs in two containers.

The first one has the network. It downloads what the build needs into a cache volume: npm packages, Rust crates, and six helper files for the AppImage. Each download is checked against a hash committed in this repository before it is kept.

The second one has no network at all (`--network none`). It installs the npm packages from the cache, builds the frontend, compiles the application with `cargo --locked --offline`, and makes the packages. A tool that tries to fetch something at this point fails, and the build stops.

For the macOS application, the second container is also the only one that sees the Apple SDK, mounted read-only, and it checks the hashes again before it unpacks it.

The cache volume is shared by every build of the same recipe on your machine, so the second container does not trust it. It mounts it read-only and checks again what it takes from it: npm checks each package against `package-lock.json`, the recipe checks each Rust crate against `Cargo.lock` and each helper file against its hash. Cargo gets a fresh home inside the container, so a configuration file or an unpacked crate left in the volume by another build is never read.

## What is pinned

| Input | Pinned to | Where |
|---|---|---|
| Base image | Ubuntu 22.04, by sha256 digest | `reproducible/Dockerfile` |
| System packages (GTK, WebKitGTK, compilers, dpkg, rpm) | a dated snapshot of the Ubuntu archive, `snapshot.ubuntu.com` | `reproducible/Dockerfile` |
| rustup | 1.29.1, by sha256 of the installer | `reproducible/Dockerfile` |
| Rust | 1.97.0, by sha256 of its release manifest. rustup installs each package from a local copy checked against the hash in that manifest, and downloads nothing itself | `rust-toolchain.toml`, `reproducible/Dockerfile` |
| Node | 24.19.0, by sha256 of the tarball | `reproducible/Dockerfile` |
| npm packages, Tauri CLI included | resolved versions and their hashes | `package-lock.json` |
| Rust crates | resolved versions and their hashes, plus a git revision for the one patched crate | `src-tauri/Cargo.lock` |
| Rust core | full commit sha | `.github/gerfaut-core.rev` |
| linuxdeploy, its three plugins and AppRun | sha256 of each file | `.github/linuxdeploy.sha256` |
| AppImage runtime | dated release, sha256 | `reproducible/linux/appimage-runtime.sha256` |
| Windows: clang-cl, llvm-lib, llvm-rc (LLVM 15) and NSIS 3.08 | the same dated snapshot of the Ubuntu archive | `reproducible/Dockerfile` |
| Windows: the Rust standard library for `x86_64-pc-windows-msvc`, and the linker `rust-lld` | the Rust release manifest above | `reproducible/Dockerfile` |
| Windows: xwin | 0.10.0, by sha256 of the release archive | `reproducible/Dockerfile` |
| Windows: Microsoft C runtime 14.44 and Windows SDK 10.0.26100 | Microsoft's channel manifest for Visual Studio 17.14.41, the sha256 of each of the 41 files it leads to, and one hash for the unpacked tree | `reproducible/windows/manifest_17.json`, `microsoft-sdk.sha256`, `microsoft-sdk-tree.sha256` |
| Windows: `nsis_tauri_utils.dll`, the plugin Tauri's installer calls | 0.5.3, by sha256 | `reproducible/windows/nsis-plugin.sha256` |
| macOS: clang, llvm-ar, llvm-lipo and llvm-objdump | LLVM 22.1.8, by sha256 of the official release archive | `reproducible/Dockerfile` |
| macOS: the Rust standard library for `aarch64-apple-darwin` and `x86_64-apple-darwin`, and the linker `rust-lld` | the Rust release manifest above | `reproducible/Dockerfile` |
| macOS: rcodesign | 0.29.0, by sha256 of the release archive | `reproducible/Dockerfile` |
| macOS: zip 3.0 and cpio | the same dated snapshot of the Ubuntu archive | `reproducible/Dockerfile` |
| macOS: the Apple SDK 26.1, from Xcode 26.1.1 (17B100) | sha256 of the Xcode archive and of the two SDK tarballs | `reproducible/macos/apple-sdk.sha256` |
| macOS: `gen-sdk.py` and `extract_xcode.py`, from Bitcoin Core | a copy of each, with its commit and its sha256 | `reproducible/macos/` |
| macOS: `gen-sdk-cryptexes.py` | this repository | `reproducible/macos/` |

On top of the versions, the recipe fixes what a tool could pick up from its surroundings. `SOURCE_DATE_EPOCH` is the date of the commit being built. The timezone is UTC, the locale is `C` and the umask is 022. The build path is always `/build`, and `--remap-path-prefix` turns the few absolute paths the compiler records into `/gerfaut`, `/cargo` and `/rustup`. Incremental compilation is off. The home directory is an empty one inside the build tree, so no configuration file is found by accident.

## What the recipe changes in Tauri's packages

Tauri's bundler makes the three packages, so their content is what a plain `npm run tauri build` gives: the same binary, desktop entry, icons, package name and dependencies. The bundler ignores `SOURCE_DATE_EPOCH`, so the recipe brings each package to a canonical form afterwards.

### .deb

Tauri stamps the wall clock on the three `ar` members and on every entry of the two tar archives, and writes the entries in the order its file walk found them. The recipe unpacks the package and writes it again with `dpkg-deb`. The differences with Tauri's file are these, and nothing else:

- every date is the commit date
- the tar entries are sorted by name, and so are the lines of `md5sums`
- the tar archives are in the format `dpkg-deb` writes, with a leading `./` on each path

The control file, the installed files and their modes are the same. The compression is still gzip.

### .rpm

Tauri builds the package with the `rpm-rs` library, which writes the wall clock into two header tags: `BUILDTIME`, and `FILEMTIMES`, the date of each installed file. `reproducible/linux/rpm-normalise.py` overwrites these two tags with the commit date and recomputes the header digests. The file keeps its size and every other byte. `rpm --checksig` then checks the result during the build.

### .AppImage

Three things make the AppImage stable. The recipe dates every file of the AppDir, the directory the AppImage is made from, with the commit date. It fixes one symbolic link that would otherwise depend on the machine. And it gives `appimagetool` a runtime file pinned by hash, through `LDAI_RUNTIME_FILE`.

The dates first. The `mksquashfs` inside `appimagetool` brings any date later than `SOURCE_DATE_EPOCH` down to it, and leaves an earlier date alone. A few directories of the AppDir, such as the `gtk-3.0` one linuxdeploy copies from the image, carry the date the image was built. An image built after the commit gave the commit date, an image built before it kept its own, and two such builds differed by that date alone. So every file and directory is dated with the commit date before the AppImage is written.

The link is `gerfaut-desktop.png`, the icon at the root of the AppDir, next to the desktop entry that names it. linuxdeploy points it at one of the icons of `usr/share/icons/hicolor`, and the version Tauri pins takes the first one it finds while it reads the directory. That order depends on the file system the build runs on: two GitHub runners once linked it to the 32x32 icon on one and to the 64x64 icon on the other, and nothing else differed. Newer releases of linuxdeploy choose by size instead, the closer to 64x64 the better. The recipe applies that rule, so the link always points at the 64x64 icon.

With the dates and the link fixed, the recipe writes the AppImage again from the same AppDir, with the same pinned `linuxdeploy-plugin-appimage`, runtime and environment: the last step of Tauri's bundler, repeated. Run on the AppDir as the bundler left it, that step gives back Tauri's AppImage byte for byte. The contents of the files are untouched.

The runtime matters as much. Without the pinned file, `appimagetool` downloads the runtime at build time from a release named `continuous`, which changes without notice, and that file ends up at the head of every AppImage. The build checks that the finished AppImage starts with the pinned runtime. Only the 16 bytes of the `.digest_md5` section may differ: that is where `appimagetool` writes the checksum of the payload.

The libraries inside the AppImage (WebKitGTK, GTK and what they need) are copied from the image by linuxdeploy. They come from the dated Ubuntu snapshot, which is why the snapshot is part of the promise.

## The Windows installer

The installer is what `npm run tauri build` makes on Windows, minus the clock: the same application, the same NSIS template from Tauri, the same icons, shortcuts and registry entries. It differs from a build made on Windows in the tools that make it, and those are listed here.

### How it is compiled

The target is `x86_64-pc-windows-msvc`. It is the only Windows target Tauri supports, and the one where the WebView2 loader is linked into the program, so the application stays a single `.exe`. rustc compiles the Rust code as it does on Windows. `clang-cl` compiles the C code some crates carry (SQLite, zstd, ring, aws-lc) in place of Microsoft's `cl.exe`. `rust-lld`, the linker that ships with the pinned Rust toolchain, replaces Microsoft's `link.exe`. `llvm-rc` compiles the version resource and the application manifest.

[xwin](https://github.com/Jake-Shadle/xwin) downloads the Microsoft headers and libraries. The recipe gives it a committed copy of Microsoft's channel manifest, so it asks for the same packages next year as today. xwin checks each package against the hash the package manifest gives. It cannot check the package manifest itself, because the hash Microsoft publishes for that file is wrong. The recipe closes the gap: it downloads that file on its own, checks it against `microsoft-sdk.sha256`, and only then lets xwin read it. After the download, the whole directory is compared with the list. After unpacking, the whole tree is hashed and compared with `microsoft-sdk-tree.sha256`, and the build phase does that once more before it compiles.

Microsoft can remove these files from its servers one day. If that happens, an old tag stops being rebuildable by someone who does not already have them. A copy of the cache volume protects you from that. It is for your own use, not for publishing.

### What keeps the clock out

A Windows program has a timestamp in its header. The recipe passes `/Brepro` to the linker, which writes a hash of the program there.

rustc asks the linker for a `.pdb` debug file even in a release build, and the program then carries the name of that file and an identifier the linker derives from its content. That content names the temporary directory rustc links in, and that name is random. The first double build differed by these 20 bytes and nothing else. The recipe passes `/DEBUG:NONE`: the linker writes no `.pdb` and no reference to one. The `.pdb` was never shipped, so the installed program loses nothing.

`makensis` stores the modification date of every file it packs. Tauri's bundler rewrites the application just before it calls `makensis`, so that date would be the time of the build. The recipe adds one instruction to the installer script, `SetDateSave off`, through the hook file Tauri's template includes (`reproducible/windows/hooks.nsh`). Tauri's template itself is used as it is. With this instruction no file date enters the installer, and an installed file is dated from the moment you install it.

The head of every NSIS installer is a small Windows program, the stub, that `makensis` copies from its own package. The uninstaller inside the installer is made from the same stub. They are files of the Ubuntu `nsis` package, which is why that package is pinned by the snapshot. The icon, the version information and the manifest of the installer are written into the stub by `makensis`, from the configuration in git.

The installer embeds no WebView2 runtime. Like the default Tauri installer, it downloads Microsoft's WebView2 bootstrapper at install time, only on a machine that lacks WebView2. Windows 11 ships it.

### What differs by design

Nothing. The published installer and your rebuild are the same bytes.

This holds as long as the installer has no Authenticode signature, which is the case today. Windows therefore shows a SmartScreen warning on first launch. A signature is made with a private key and cannot be rebuilt. If releases are signed one day, this page will explain how to strip the signature before comparing.

### What is tested, and where

A matching hash says nothing about whether the program runs. The `Reproducible build` and `Release` workflows therefore take the installer built on Linux to a Windows runner. It checks that the hash is the one the Linux job printed, installs it silently, reads the version information of the installed program, starts it for 10 seconds, checks that it opened a WebView2 window, then uninstalls it and checks that nothing is left.

## The macOS application

The zip holds `Gerfaut.app`, the application Tauri builds on a Mac with `tauri build --target universal-apple-darwin`: one program for Apple silicon and Intel, the same bundle, and a signature Tauri writes when told to sign ad hoc. It differs from a build made on a Mac in the tools that make it, and those are listed here.

### How it is compiled

The application is compiled twice through the Tauri CLI, once for `aarch64-apple-darwin` (Apple silicon) and once for `x86_64-apple-darwin` (Intel), as Tauri does on a Mac. rustc compiles the Rust code as it does on a Mac. clang, from the official LLVM 22.1.8 release, compiles the C and Objective-C code some crates carry (SQLite, zstd, ring, aws-lc, and the notification code of `mac-notification-sys`) in place of Apple's clang. `rust-lld`, the linker that ships with the pinned Rust toolchain, replaces Apple's `ld`, as it replaces `link.exe` for Windows. `llvm-lipo` joins the two programs into one universal binary, where Tauri calls Apple's `lipo`.

The oldest macOS each half runs on is the one a Mac build gets: 10.13 on Intel, the `LSMinimumSystemVersion` Tauri writes, and 11.0 on Apple silicon, the first macOS that ran on it. The linker records the SDK version, 26.1, in each half, as Xcode's linker does. The build checks both values after linking.

The two linkers pick a library for each symbol in a different way. A few symbols, the keys WebKit uses for cookies, are exported by two libraries, Foundation and CFNetwork, and CFNetwork comes first on the command line. `rust-lld` takes the first library that has a symbol, Xcode's linker takes Foundation. The recipe puts Foundation first (`-lframework=Foundation`), so both halves load the same libraries as a build made on a Mac, and the build stops if CFNetwork shows up again.

aws-lc-sys builds aws-lc with its `cc`-based build, the one it picks on a Mac too. The recipe sets `AWS_LC_SYS_CMAKE_BUILDER=0` so that it never tries CMake, whose Apple branch only runs on a Mac.

rustc strips the debug information of an Apple program with `rust-objcopy`, a tool of the Rust toolchain. In Rust 1.97.0 for Linux, that tool cannot find the LLVM library it is linked against: rustc then prints a warning and leaves the debug map in the program, with the paths of the build in it. The image adds the link the tool looks for, so the program is stripped as on a Mac.

### How the bundle is laid out

Tauri's macOS bundler only compiles on a Mac. The recipe lays the bundle out itself, the way that bundler does:

```
Gerfaut.app/Contents/Info.plist
Gerfaut.app/Contents/MacOS/gerfaut-desktop
Gerfaut.app/Contents/Resources/icon.icns
Gerfaut.app/Contents/_CodeSignature/CodeResources
```

`reproducible/macos/info-plist.py` writes `Info.plist` from `tauri.conf.json`: Tauri's keys, in Tauri's order, in the same XML text, byte for byte. The icon is `src-tauri/icons/icon.icns`, copied as it is. If the configuration asks for something the script does not handle, such as file associations or extra resources, it stops, rather than write a bundle that differs from Tauri's.

The `macos-reference` job of the workflow checks this. It builds the same commit on a Mac with Tauri's own bundler and compares the two bundles: the same `Info.plist` byte for byte, the same icon, the same files with the same modes, and in each half of the program the same libraries and the same macOS versions. The one difference is `_CodeSignature`, because Tauri signs nothing when no signing identity is set.

### The signature

On Apple silicon every program must be signed, and a program whose signature does not cover the rest of its bundle can be reported as damaged once downloaded. The recipe signs the whole bundle ad hoc with [rcodesign](https://github.com/indygreg/apple-platform-rs), as Tauri's bundler does when told to sign with the identity `-`. The signature seals the program and the other files of the bundle together, in `_CodeSignature/CodeResources`. Its identifier is `CFBundleIdentifier`, `com.gerfautwallet.gerfaut`, and it turns the hardened runtime on, which is Tauri's default.

An ad hoc signature holds hashes and nothing else: no certificate, no key, no date, no answer from a server. The build makes it again byte for byte, like the rest. The linker's own signature is turned off (`-no_adhoc_codesign`): the bundle is signed once, when it is complete.

The application is not notarised. The first time you open a downloaded copy, macOS refuses it. Open System Settings, then Privacy & Security, and click Open Anyway.

### The zip

`zip` 3.0 from the pinned Ubuntu snapshot writes `Gerfaut_<version>_universal.zip`, after the signature. Every file and folder is dated with the commit date, in UTC. The entries are sorted by name. The modes are fixed: 755 for the folders and the program, 644 for the other files. `-X` leaves out the fields that would carry an owner or a second date. Finder unpacks the zip as it is, modes and signature included.

There is no `.dmg`. Making one reproducibly on Linux takes three more tools and a fake clock, which is how Tor Browser does it, and a zip carries the same bundle.

### What keeps the clock out

The linker writes no date into a Mach-O program, and it derives the program's identifier (`LC_UUID`) from the content. rustc and clang see the same fixed paths as for Linux, remapped to `/gerfaut`, `/cargo`, `/rustup` and `/sdk`, and the build stops if a path of the container is left in the program. The signature has no date, and every date in the zip is the commit date.

### What differs by design

Nothing. The published zip and your rebuild are the same bytes.

This holds as long as the application is signed ad hoc and not notarised, which is the case today. A Developer ID signature is made with a private key, and notarisation adds a ticket from Apple: neither can be rebuilt. If releases get them one day, this page will explain how to set them aside before comparing, as Bitcoin Core does with its detached signatures.

### What is tested, and where

A matching hash says nothing about whether the program runs on a Mac. The `Reproducible build` and `Release` workflows therefore take the zip built on Linux to two macOS runners, one with Apple silicon and one with Intel. On each, it checks the hash, unpacks the zip with `ditto`, which is what Finder uses, and checks the signature with `codesign --verify --deep --strict`: ad hoc, with sealed resources and the hardened runtime. It checks that the program holds both halves, starts the application and checks that it still runs 10 seconds later. Then it marks a copy as downloaded by Safari and checks that Gatekeeper refuses it for the ordinary reason, and does not call it damaged.

In the workflow, the Apple SDK comes from the Xcode 26.1.1 of a macOS runner, made with the same two scripts and checked against the same hashes. It reaches the Linux jobs through the Actions cache of the repository, encrypted with a key that pull requests from forks never get, and it is never uploaded as an artifact.

## The binary

The three Linux packages do not hold the same binary. Tauri writes the kind of package into the executable before it bundles it: three bytes, `DEB`, `RPM` or `APP`. The `.deb` and the `.rpm` binaries differ by those three bytes and nothing else. The AppImage one differs more, because linuxdeploy also strips it and sets its library path. `build-info/binary.sha256` is the hash of the executable as the compiler left it, before any of this.

For macOS, `build-info/binary.sha256` holds the two halves as the linker left them and the universal binary before signing. `build-info/macho.txt` lists what each half targets and which libraries it loads, and `build-info/signature.txt` describes the signature.

`build-info/sources` names the two commits a build came from. A build made with `--any-core`, against a core other than the pinned one, says so in that file, and `compare.sh` repeats it. Such a build is for development and is never what a release is compared with.

The release profile is Cargo's default: optimised, 16 codegen units, no LTO, debug information stripped, symbol table kept. None of it needed changing. The compiler gives the same output for the same input whatever the number of parallel jobs, and the build stops if the binary still contains a path of the build container.

## When the hashes differ

`compare.sh` does not stop at "different". It opens both files and reports where they differ: which member of the `.deb` and which field of which entry, which header tag of the `.rpm`, the runtime or the payload of the AppImage, for the Windows installer the stub, the script or the packed file, down to the section of the program inside it, and for the macOS zip the entry and, inside the application, the half, the load command, the section or the first signed page that differs. If both sides have a `build-info` directory, it also tells you whether the toolchain, the frontend or the binary already differed, or whether the difference comes from packaging alone. Then it builds a second image that has [diffoscope](https://diffoscope.org/) and writes a full report for each file into `diffoscope/`, inside the second directory.

A downloaded file is treated as hostile until its hash matches. The comparison runs in a container with no network, both directories are mounted read-only, and the report directory is the only place it can write to. The verdict rests on the hashes alone. The explanation stops at fixed limits, so a crafted file cannot make it hang or fill the memory, and control characters are escaped before anything is printed.

The usual causes, most likely first:

- The release was not built with this recipe. See "Scope" above.
- `build-info/image-packages` differs. The two images do not hold the same system packages. This should not happen with the snapshot in place. If it does, check that the image was built from the `Dockerfile` of the tag.
- You built a branch or a later commit and not the tag. The commit date alone changes every package.
- The build ran outside the container, or with a modified `GERFAUT_RUN_ARGS` that mounts something over `/build`.

If none of these explains it, please open an issue with the output of `compare.sh`. A mismatch nobody can explain is a bug in the recipe or a problem with the release, and both are worth knowing about.

## Troubleshooting

`gerfaut-core <sha> is not in ../gerfaut-core: fetch it first`. Your clone of the core is older than the pinned commit. Run `git -C ../gerfaut-core fetch`.

`.../Xcode-26.1.1-... is not the file this recipe pins`. A tarball in the directory you passed with `--macos-sdk` is not the SDK this recipe pins. Make both again from Xcode 26.1.1 with `make-apple-sdk.sh`, and check the hash of the `.xip` first.

`<name> does not match the hash in ...`. One of the pinned downloads changed upstream. The build refuses to go on, which is the point. An older tag can stop being rebuildable this way if upstream removes or replaces a file. Keeping a copy of the cache volume (`gerfaut-desktop-rb-cache-<target>-<rust version>-<recipe>`) avoids that.

The build is killed without an error message. The container engine ran out of memory. Give it 8 GB, or lower the number of parallel jobs with `--jobs 4`.

`docker: permission denied`. Your user cannot reach the Docker daemon. Use `sudo`, add your user to the `docker` group, or use Podman with `GERFAUT_ENGINE=podman`.

With rootless Podman on a system with SELinux, bind mounts need a label. Set `GERFAUT_RUN_ARGS="--security-opt label=disable"`.

## What the CI proves, and what it does not

The `Reproducible build` workflow builds each target twice in the pinned image, on two separate runners, and fails if any hash differs. That catches what varies from one build to the next: dates, file order, parallelism, leftover state, the machine itself. The `Release` workflow runs the same builds, comparisons and tests on every tag, and drafts the release only when all of them pass: the files you download were built twice with the same bytes before anyone could download them.

It does not prove that a build on your machine matches. Only your own rebuild does that, and this page exists for that reason.

## What is not reproducible

The container image itself. Two builds of `reproducible/Dockerfile` do not give the same image bytes, because layer archives carry dates. They do give the same installed packages, toolchain and tools, and that is what reaches the artefacts. `build-info/image-packages` lists the system packages of the image a build ran in, so two builds can be compared on that point too.
