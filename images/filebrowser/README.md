# File Browser source and build

This directory contains the FileBrowser Quantum source needed by the workspace
image. It builds a static Linux amd64 binary with the frontend embedded.

- `upstream-2.1.2.tar.gz`: committed source from
  [user187x/filebrowser-quantum](https://github.com/user187x/filebrowser-quantum/tree/91bc608f0ec6a3246c29e5fc87acdd46a5fadf44).
- `patches/coder-workspace.patch`: recovered workspace changes and their tests,
  including opt-in Cloud Drive symlink targets, generated configuration and API
  documentation, and the pinned `x/net` update.
- `manifest.json`: upstream revision, source hashes, binary version and checksum.
- `Dockerfile`: pinned Node and Go builder images, locked dependencies, frontend
  tests, backend race tests, and static compilation with MuPDF support.
- `LICENSE`: the source's Apache 2.0 license, also preserved inside the archive.

The custom changes were recovered from the local `fix/symlink-targets` work
recorded as `bd57e223`, `f5e0d43f`, and `56759539`. Those commits were not published
in the GitHub fork. The patch preserves the recovered source and tests; its
checksum identifies the maintained copy here. The binary retains the original
`f5e0d43` revision string for compatibility with the existing build.

## Build and test

From the repository root, with Docker, Python 3.12 or newer, and `patch` installed:

```sh
python3 images/filebrowser/build.py
python3 images/filebrowser/build_test.py
python3 images/filebrowser/smoke_test.py images/filebrowser/bin/filebrowser-quantum
```

The build verifies the source archive and patch before extraction, runs the
frontend tests and backend race tests, and compiles the binary. It installs
`images/filebrowser/bin/filebrowser-quantum` only after the output matches the
manifest's checksum. Build outputs stay under ignored `build/filebrowser/` and
`images/filebrowser/bin/`. The first build needs network access for the pinned
builder images and package dependencies. Docker caches subsequent builds.

Workspace image and source release builds invoke this builder when their binary
input is absent. A source kit contains the archive, patch, license, and recipe,
and optionally includes an already verified binary.

To inspect or work on the patched source without building:

```sh
python3 images/filebrowser/build.py --extract build/filebrowser/source
```

The destination must not exist. Maintain changes in the patch, update its hash in
`manifest.json`, and test the extracted source and resulting binary. Run the
upstream `make generate-docs` when changing configuration or API definitions,
and include those generated files in the patch. Changes to
the binary checksum must also update the workspace Dockerfile's pinned input.

## Recover an existing binary

`restore.py` remains available for binaries matching the current manifest. Use
`--file PATH`, `--image IMAGE`, or `--pod POD --container CONTAINER --context CONTEXT`.
It verifies the checksum before replacing the input. Building from the included
source does not require access to a running workspace or an old image.
