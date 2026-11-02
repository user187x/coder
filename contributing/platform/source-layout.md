# Platform source and air-gapped releases

Maintain source in these locations:

| Location                  | Contents                                                                                    |
|---------------------------|---------------------------------------------------------------------------------------------|
| `platform/`               | Platform service, workspace runtime helpers, and their tests                                |
| `platform/online/`        | The older service used by the online Helm chart; kept separate because its behavior differs |
| `images/`                 | Image recipes, workspace assets, and build inputs                                           |
| `helm/coder-airgapped/`   | Air-gapped Helm chart and vendored subcharts                                                |
| `helm/coder-platform/`    | Online Helm chart                                                                           |
| `packaging/airgap/`       | Installer templates, pinned image inventory, and deployment assets                          |
| `scripts/release/airgap/` | Release helpers and verification suites                                                     |
| `contributing/platform/`  | Platform development notes, architecture decisions, and release history                     |

The charts reference Python source with relative symlinks. Edit the files under
`platform/`; Helm includes their contents when rendering or packaging a chart.
The online service is an existing implementation, not a copy of the current
platform service. Consolidating its behavior requires a separate migration.

Kernel and eBPF research projects live in `images/research-workspace/source/`.
The optional [research workspace image](../../images/research-workspace/README.md)
includes these sources and compiles them for its disposable guest kernel.

## Check source

From the repository root:

```sh
./scripts/build_airgap_release.sh --check
./scripts/build_airgap_release.sh --unit
python3 scripts/release/airgap/assemble_test.py
./scripts/build_airgap_release.sh --tool verify/release_version.py
```

Source checks do not require saved image archives. To include the archive
presence and checksum-manifest checks, run:

```sh
./scripts/build_airgap_release.sh --verify-bundle
```

## Produce a release

Preview the release or write its files to an output directory:

```sh
./scripts/build_airgap_release.sh --plan
./scripts/build_airgap_release.sh --out /path/to/releases/coder-1.5.2
```

The version comes from `RELEASE_VERSION`. The release cache defaults to
`${XDG_CACHE_HOME:-$HOME/.cache}/coder/airgap/releases/<version>/`.
Use `--cache-dir` to select another cache. It contains `images/<group>/*.tar.gz`
and, for source builds, `inputs/filebrowser-quantum`. Archive hashes must match
`packaging/airgap/archive-checksums/`.

Run a source image build through the same entry point:

```sh
./scripts/build_airgap_release.sh --tool build-source-release.sh -- REGISTRY --dataflow
```

This requires the connected build dependencies documented in the release helpers
and the File Browser payload in the cache. It is distinct from packaging existing
release images.

The entry point assembles the installer layout in a temporary directory under
ignored `build/` output. `packaging/airgap/source-layout.json` maps source
directories into that layout. Existing installers keep their internal
`airgap-dist` paths only inside generated output. The temporary tree is removed
when the command finishes; release output and the external cache are retained.
Helpers that write to the installer's `dist/` directory use
`build/airgap-artifacts/<version>/`, or `--out` when supplied.
Use the entry point rather than invoking the internal helpers directly, since
they operate on the generated installer layout.
