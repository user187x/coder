# The Coder fork (separate repository)

The Coder server image is built from the fork, which lives in its own repository and is **not** part of this one.

| | |
|---|---|
| Repository | `git@github.com:user187x/coder.git`, branch `main` (local clone: `~/workspace/coder`) |
| Image | `ghcr.io/user187x/coder-platform:2.0.0-platform.108` (`coder version`: `v2.0.0-platform.108+866faf2`) |
| Built from | `866faf2ffad2fe858f08ff40896587ba920242f8`, clean tree, 2026-10-22 |
| Air-gap image | `…:2.0.0-platform.108-airgap` = the image above + Terraform provider mirror (`../airgap-image/`, `../tools/build-airgap-image.sh`); it is what the chart runs |
| Previous | `2.0.0-platform.107` (`4a18b5603`), `2.0.0-platform.106` (`a14d152f7`), `2.0.0-platform.105` (`8409a8430`), `2.0.0-platform.104` (`ad1866e1c`), `2.0.0-platform.103` (`365fa0db2`), `2.0.0-platform.102` (`5ec304d58`), `2.0.0-platform.101` (`98c3d3f4c`), `2.0.0-platform.100` (`16bcafe19`), `2.0.0-platform.99` (`f69299bdc`), `2.0.0-platform.98` (`61769b225`), `2.0.0-platform.97` (`1b6b14dbf`), `2.0.0-platform.96` (`c62a06cae`), `2.0.0-platform.95` (`704883071`), `2.0.0-platform.94` (`ce69e5f1d`), `2.0.0-platform.93` (`9cc047a24`), `2.0.0-platform.92` (`2474ba1c9`), `2.0.0-platform.91` (`535dd8d6b`), `2.0.0-platform.90` (`e94a535e1`), `2.0.0-platform.89` (`7b903b141`), `2.0.0-platform.88` (`1cd7789a8`), `2.0.0-platform.87` (`ceeb34617`), `2.0.0-platform.86` (`96a726a61`), `2.0.0-platform.85` (`897b19a56`), `2.0.0-platform.84` (`399ab8d36`), `2.0.0-platform.83` (`b5c7e8a82`), `2.0.0-platform.82` (`ab28cfacb`), `2.0.0-platform.81` (`0450ceb45`), `2.0.0-platform.80` (`48b7ca115`), `2.0.0-platform.79` (`7aadca175`), `2.0.0-platform.78` (`ffd388ce4`), `2.0.0-platform.77` (`b679b7fda`), `2.0.0-platform.76` (`86382f86c`), `2.0.0-platform.75` (`e7b111dc2`), `2.0.0-platform.74` (`78563a90c`), `2.0.0-platform.73` (`2c3850c50`), `2.0.0-platform.72` (`3f195b588`), `2.0.0-platform.71` (`5556ea702`), `2.0.0-platform.70` (`13ea8c2ef`), `2.0.0-platform.69` (`766e97304`), `2.0.0-platform.68` (`0aa4dad65`), `2.0.0-platform.67` (`1f50059bf`), `2.0.0-platform.66` (`c8ecc15bb`), `2.0.0-platform.65` (`474bc71e0`), `2.0.0-platform.64` (`d07017c9a`), `2.0.0-platform.63` (`e70a0fa40`), `2.0.0-platform.62` (`7ff6c60b4`), `2.0.0-platform.61` (`83d117cf3`), `2.0.0-platform.60` (`ded482c18`), `2.0.0-platform.59` (`604a6d7e1`), `2.0.0-platform.58` (`c3bc692ae`), `2.0.0-platform.57` (`fa2a23742`), `2.0.0-platform.56` (`8ff763c27`), `2.0.0-platform.55` (`3238093da`), `2.0.0-platform.54` (`7f53e3736`), `2.0.0-platform.53` (`cc7d3c87c`), `2.0.0-platform.52` (`6815ad4ee`), `2.0.0-platform.51` (`1bf586ae6`), `2.0.0-platform.50` (`6c603ad0c`), `2.0.0-platform.49` (`190bd7188`), `2.0.0-platform.48` (`c3df9f128`), `2.0.0-platform.47` (`1c36a2994`), `2.0.0-platform.46` (`c82bf2909`), `2.0.0-platform.45` (`21d206361`), `2.0.0-platform.44` (`6a87d6432`), `2.0.0-platform.43` (`9cb97bba8`), `2.0.0-platform.42` (`60a0b781b`), `2.0.0-platform.41` (`342887302`), `2.0.0-platform.40` (`ba5076696`), `2.0.0-platform.39` (`7cf80f05d`), `2.0.0-platform.38` (`f66b8341c`), `2.0.0-platform.37` (`889b4f7d3`), `2.0.0-platform.36` (`4cfa2ca88`), `2.0.0-platform.35` (`ac6508b0e`), `2.0.0-platform.34` (`4885d2c81`), `2.0.0-platform.33` (`599afe8ed`), `2.0.0-platform.32` (`716ec4dec`), `2.0.0-platform.31` (`2e7ae6ff9`), `2.0.0-platform.30` (`025b37162`), `2.0.0-platform.29` (`d799ac97b`), `2.0.0-platform.28` (`4e31952b0`), `2.0.0-platform.27` (`6b26be930`), `2.0.0-platform.26` (`100cc87d8`), `2.0.0-platform.25` (`c174bed4b`), `2.0.0-platform.24` (`fafe5314b`), `2.0.0-platform.23` (`0eb28965f`), `2.0.0-platform.22` (`73fed2459`), `2.0.0-platform.21` (`fb996a288`), `2.0.0-platform.20` (`f3887b544`), `2.0.0-platform.19` (`2260748f8`), `2.0.0-platform.18` (`25b73e9ed`), `2.0.0-platform.17` (`73d2c8a54`), `2.0.0-platform.16` (`6e0f2b39b`), `2.0.0-platform.15` (`0a8293071`), `2.0.0-platform.14` (`84b706a1f`), `2.0.0-platform.13` (`237423e43`), `2.0.0-platform.12` (`2bd982755`), `2.0.0-platform.11` (`92daaa856`), `2.0.0-platform.10` (`f6ebdb50e`), `2.0.0-platform.9` (`019d9745b`), `2.0.0-platform.8` (`a68ffe61e`), `2.0.0-platform.7` (`d7a068929`), `2.0.0-platform.6` (`a65bc39b7`), `2.0.0-platform.5` (`ea80521c2`), `2.0.0-platform.4` (`v2.0.0-platform.4+d01b8f6`, built from `d01b8f6` plus uncommitted changes) |

`main` is pushed up to `866faf2ff` (platform.108).

**Build requirements:** Go (1.26), Docker, and Node.js **22–24** (the dashboard's `engines`; Node 26 fails `pnpm build`
and its unit tests) with pnpm (`corepack pnpm`). E.g. `PATH=~/.config/nvm/versions/node/v24.21.0/bin:$PATH`, plus a
`pnpm` shim (`exec corepack pnpm "$@"`) on the PATH.

## New fork version

```bash
cd ~/workspace/coder
./scripts/build_platform_image.sh --image ghcr.io/user187x/coder-platform --tag 2.0.0-platform.108 --arch amd64   # [--push]
cd -; ../tools/build-airgap-image.sh 2.0.0-platform.108
```

Then, in this repository: update the pinned commit above, the image tag in
`helm-chart/coder-airgapped/values.yaml` (`coder.coder.image.tag`), the `[custom]` line (tag and digest) in
`helm-chart/images.txt`, `appVersion` + `version` in `helm-chart/coder-airgapped/Chart.yaml`, and `CHANGELOG.md`.

**Following upstream and rolling back:** [`UPSTREAM.md`](UPSTREAM.md) (taking each upstream release: trial merge,
conflict rules, the verification gate) and [`ROLLBACK.md`](ROLLBACK.md) (back to pure upstream Coder and forward
again, with no change to the database or the workspaces).
