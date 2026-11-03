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
./scripts/build_airgap_release.sh --out /path/to/releases/coder-1.6.4
```

The version comes from `RELEASE_VERSION`. The release cache defaults to
`build/airgap-cache/<version>/` inside the project.
Use `--cache-dir` to select another cache. It contains `images/<group>/*.tar.gz`
and its archive hashes must match `packaging/airgap/archive-checksums/`.
The custom File Browser source, patches, and build recipe belong in `images/filebrowser/`.
Follow its [build instructions](../../images/filebrowser/README.md) to compile the
verified binary into ignored `images/filebrowser/bin/`. Workspace and source release
builds compile it automatically when the binary is absent.

Run a source image build through the same entry point:

```sh
./scripts/build_airgap_release.sh --tool build-source-release.sh -- REGISTRY --dataflow
```

This requires the connected build dependencies documented in the release helpers
and builds the verified File Browser input when needed. It is distinct from packaging existing
release images.

The source build produces both server editions, packages both charts, and writes
the resulting image pins and contents inventory back to `packaging/airgap/` and
`platform/`. Review and commit those metadata changes with the release.

Export the built images into the project cache before creating an offline bundle:

```sh
python3 scripts/release/airgap/export_images.py --reuse-cache /path/to/previous/cache
```

The optional previous cache supplies public image archives only when their hashes
match the committed checksums. Our images are exported from Docker after their
IDs are checked against the release inventory. Archive checksums are updated in
`packaging/airgap/archive-checksums/`.

Package committed source, including graphics and the verified File Browser input:

```sh
python3 scripts/release/airgap/source_kit.py build/source-kit
```

The `platform-release` CI workflow checks an extracted source kit as well as
the platform tests, chart checks, release versions, and research runner tests.

The entry point assembles the installer layout in a temporary directory under
ignored `build/` output. `packaging/airgap/source-layout.json` maps source
directories into that layout. Existing installers keep their internal
`airgap-dist` paths only inside generated output. The temporary tree is removed
when the command finishes; release output and the image cache are retained.
Helpers that write to the installer's `dist/` directory use
`build/airgap-artifacts/<version>/`, or `--out` when supplied.
Use the entry point rather than invoking the internal helpers directly, since
they operate on the generated installer layout.

## Prepare a deployment rollback

Save the current Helm configuration, Kubernetes resources and secrets, and all
databases in the deployment's CloudNativePG cluster:

```sh
python3 scripts/release/backup-deployment.py --context CONTEXT
```

The command writes a private snapshot under `build/deployment-backups/`, restores
the database dumps into a disposable PostgreSQL container with no network, and
writes `VERIFIED.json` only after restoration succeeds. The source cluster is
read only throughout. Preserve this directory and the previous release images
before an upgrade. It contains credentials and must remain outside Git.
Workspace volumes and Cloud Drive object data require their own storage backups.
