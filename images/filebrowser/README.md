# File Browser build input

`manifest.json` pins the Linux amd64 FileBrowser Quantum binary used by the
workspace image. Its custom build supports the Cloud Drive's symlink targets.
The binary is a build input, not the corresponding Go source tree.

Restore it into ignored `images/filebrowser/bin/filebrowser-quantum` before
building or packaging a source release. From the repository root, use an existing
workspace image:

```sh
python3 images/filebrowser/restore.py --image mrshll187/coder-workspace:1.5.2
```

Alternatively, use `--file /path/to/filebrowser-quantum`, or recover it from a
workspace pod with `--pod POD --container CONTAINER --context CONTEXT`.
The command verifies the pinned checksum before replacing the local input.
Source release kits include the verified binary at the same project path.

The workspace Dockerfile also checks the binary's version, Go version, and
dependency version. To change the input, update the manifest and Dockerfile
together and validate the workspace image's File Browser checks.
