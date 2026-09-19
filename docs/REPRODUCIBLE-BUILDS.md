# Reproducible builds

The Linux packages of Gerfaut (`.deb`, `.rpm` and `.AppImage`) are built inside a container where every input is pinned. Two builds of the same commit give the same files, byte for byte, whatever the machine, the day or the number of processor cores.

This means you do not have to trust the machine that produced the file you downloaded. Rebuild the tag yourself, run `sha256sum` on your file and on the published one, and the two hashes are equal.

Nothing has to be set aside for the comparison. A Linux package carries no signature inside it. The author's [minisign](https://jedisct1.github.io/minisign/) signature covers `SHA256SUMS` and lives in a separate file, `SHA256SUMS.minisig`.

## Scope

This page covers the three Linux packages for x86_64. A release built with this recipe says so in its notes. A release that does not say so was built on a hosted runner, outside the container, and its files will not match a rebuild.

## What you need

- A Linux machine, or any machine that runs Linux containers
- Docker or Podman
- git and curl
- About 8 GB of free disk: 2.6 GB for the image, 0.6 GB of downloads, close to 4 GB while a build runs
- 8 GB of RAM for the container engine
- About 20 minutes for a first build on a recent laptop, image included, then 12 to 14 minutes per build

You need no Rust, no Node and no Python on the host. Everything runs in the container.

## Verify a published release

```sh
git clone https://github.com/gerfaut-wallet/gerfaut-desktop
gerfaut-desktop/reproducible/verify.sh v0.1.0
```

The script works in a new temporary directory and does five things:

1. It clones `gerfaut-desktop` at the tag. From there on, the recipe that runs is the one the tag carries.
2. It reads `.github/gerfaut-core.rev`, the exact commit of the Rust core this tag was built against, and clones `gerfaut-core` at that commit.
3. It builds the pinned image and the three packages.
4. It downloads the same three files from the releases page.
5. It compares them and prints a verdict.

A release that matches ends like this:

```
  identical    Gerfaut-0.1.0-1.x86_64.rpm  <sha256>
  identical    Gerfaut_0.1.0_amd64.AppImage  <sha256>
  identical    Gerfaut_0.1.0_amd64.deb  <sha256>
RESULT: identical, byte for byte
==> VERIFIED: the published linux files of v0.1.0 are the ones this source builds
```

With Podman, set `GERFAUT_ENGINE=podman` in front of the command. The script picks Docker first when both are installed. The scripts call nothing Docker-specific, but so far they have only been run with Docker. If Podman gives you a different result, please report it.

You can also do the last step by hand. The rebuilt files and their `SHA256SUMS` are in the `rebuilt` directory the script names at the start. Compare that list with the signed `SHA256SUMS` of the release: the three lines must be the same.

## Build without comparing

From a checkout of this repository, with `gerfaut-core` cloned next to it:

```sh
reproducible/build.sh linux
```

The packages land in `reproducible/out/linux/`, next to a `SHA256SUMS` file and a `build-info` directory. The script builds the commit at `HEAD`, never the working tree, and it always uses the `gerfaut-core` commit named in `.github/gerfaut-core.rev`.

To check that the build is stable on your own machine, ask for two:

```sh
reproducible/build.sh linux --twice
```

It builds twice, in two separate containers, and fails if a single byte differs. This is what the `Reproducible build` workflow runs.

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

## What is pinned

| Input | Pinned to | Where |
|---|---|---|
| Base image | Ubuntu 22.04, by sha256 digest | `reproducible/Dockerfile` |
| System packages (GTK, WebKitGTK, compilers, dpkg, rpm) | a dated snapshot of the Ubuntu archive, `snapshot.ubuntu.com` | `reproducible/Dockerfile` |
| rustup | 1.29.1, by sha256 of the installer | `reproducible/Dockerfile` |
| Rust | 1.97.0, by sha256 of its release manifest, which lists the hash of every component | `rust-toolchain.toml`, `reproducible/Dockerfile` |
| Node | 24.19.0, by sha256 of the tarball | `reproducible/Dockerfile` |
| npm packages, Tauri CLI included | resolved versions and their hashes | `package-lock.json` |
| Rust crates | resolved versions and their hashes, plus a git revision for the one patched crate | `src-tauri/Cargo.lock` |
| Rust core | full commit sha | `.github/gerfaut-core.rev` |
| linuxdeploy, its three plugins and AppRun | sha256 of each file | `.github/linuxdeploy.sha256` |
| AppImage runtime | dated release, sha256 | `reproducible/linux/appimage-runtime.sha256` |

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

The AppImage needs no rewriting. Two things make it stable. The `mksquashfs` inside `appimagetool` honours `SOURCE_DATE_EPOCH`. And the recipe gives `appimagetool` a runtime file pinned by hash, through `LDAI_RUNTIME_FILE`. Without it, `appimagetool` downloads the runtime at build time from a release named `continuous`, which changes without notice, and that file ends up at the head of every AppImage. The build checks that the finished AppImage starts with the pinned runtime. Only the 16 bytes of the `.digest_md5` section may differ: that is where `appimagetool` writes the checksum of the payload.

The libraries inside the AppImage (WebKitGTK, GTK and what they need) are copied from the image by linuxdeploy. They come from the dated Ubuntu snapshot, which is why the snapshot is part of the promise.

## The binary

The three packages do not hold the same binary. Tauri writes the kind of package into the executable before it bundles it: three bytes, `DEB`, `RPM` or `APP`. The `.deb` and the `.rpm` binaries differ by those three bytes and nothing else. The AppImage one differs more, because linuxdeploy also strips it and sets its library path. `build-info/binary.sha256` is the hash of the executable as the compiler left it, before any of this.

`build-info/sources` names the two commits a build came from. A build made with `--any-core`, against a core other than the pinned one, says so in that file, and `compare.sh` repeats it. Such a build is for development and is never what a release is compared with.

The release profile is Cargo's default: optimised, 16 codegen units, no LTO, debug information stripped, symbol table kept. None of it needed changing. The compiler gives the same output for the same input whatever the number of parallel jobs, and the build stops if the binary still contains a path of the build container.

## When the hashes differ

`compare.sh` does not stop at "different". It opens both files and reports where they differ: which member of the `.deb` and which field of which entry, which header tag of the `.rpm`, the runtime or the payload of the AppImage. If both sides have a `build-info` directory, it also tells you whether the toolchain, the frontend or the binary already differed, or whether the difference comes from packaging alone. Then it builds a second image that has [diffoscope](https://diffoscope.org/) and writes a full report for each file into `diffoscope/`, inside the second directory.

The usual causes, most likely first:

- The release was not built with this recipe. See "Scope" above.
- `build-info/image-packages` differs. The two images do not hold the same system packages. This should not happen with the snapshot in place. If it does, check that the image was built from the `Dockerfile` of the tag.
- You built a branch or a later commit and not the tag. The commit date alone changes every package.
- The build ran outside the container, or with a modified `GERFAUT_RUN_ARGS` that mounts something over `/build`.

If none of these explains it, please open an issue with the output of `compare.sh`. A mismatch nobody can explain is a bug in the recipe or a problem with the release, and both are worth knowing about.

## Troubleshooting

`gerfaut-core <sha> is not in ../gerfaut-core: fetch it first`. Your clone of the core is older than the pinned commit. Run `git -C ../gerfaut-core fetch`.

`<name> does not match the hash in ...`. One of the pinned downloads changed upstream. The build refuses to go on, which is the point. An older tag can stop being rebuildable this way if upstream removes or replaces a file. Keeping a copy of the cache volume (`gerfaut-desktop-rb-cache-<image id>`) avoids that.

The build is killed without an error message. The container engine ran out of memory. Give it 8 GB, or lower the number of parallel jobs with `--jobs 4`.

`docker: permission denied`. Your user cannot reach the Docker daemon. Use `sudo`, add your user to the `docker` group, or use Podman with `GERFAUT_ENGINE=podman`.

With rootless Podman on a system with SELinux, bind mounts need a label. Set `GERFAUT_RUN_ARGS="--security-opt label=disable"`.

## What the CI proves, and what it does not

The `Reproducible build` workflow builds the same commit twice in the pinned image and fails if any hash differs. That catches what varies from one build to the next on a single machine: dates, file order, parallelism, leftover state.

It does not prove that a build on your machine matches. Only your own rebuild does that, and this page exists for that reason.

## What is not reproducible

The container image itself. Two builds of `reproducible/Dockerfile` do not give the same image bytes, because layer archives carry dates. They do give the same installed packages, toolchain and tools, and that is what reaches the artefacts. `build-info/image-packages` lists the system packages of the image a build ran in, so two builds can be compared on that point too.

## Other platforms

The Windows and macOS installers are built on hosted runners, outside this recipe, and the promise on this page does not extend to them.
