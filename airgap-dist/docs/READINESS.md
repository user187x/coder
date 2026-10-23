# Release readiness: coder-fork 1.27.2 → 1.28.0

What was checked, against the version on GitHub (release **v1.27.2**, published 2026-10-13 with its bundle), what was
found, what 1.28.0 fixes (on `main` since; the readiness branch is merged and gone), and what is left open.

**Method:**
1. The 1.27.2 bundle was downloaded from the GitHub release into an empty directory. Its checksums matched, and its
   contents equal the `v1.27.2` tag (`diff -r` of a fresh clone: identical).
2. Every check below ran on that bundle as the baseline, then on the 1.28.0 candidate built from the branch.
3. Tests ran on an air-gapped kind cluster (egress blocked: every image from the bundle), on the development
   Minikube, and on copies of its database.

## Summary

| Check | 1.27.2 (GitHub) | 1.28.0 (candidate) |
|---|---|---|
| Static checks of the deliverable (`chart_checks.py`) | 21/25 | **27/27** |
| Air-gapped install (kind, egress blocked, images only from the bundle), steps 1–7 | images and chart pushed from the bundle; Argo CD never Healthy, and the admin bootstrap and template push never ran (see 2) | **Synced / Healthy / Succeeded in 297 s** |
| Step 8, DEPLOY.md's sign-in and workspace checks | 11/15, then crashed: no admin (401), the first Keycloak user became owner, no template | **39/39**[^1]; all four apps healthy with no internet |
| Step 9, image builder offline | the builder's registry crash-looped on the fresh install | **12/12** (built, scanned and run on the node) |
| Step 10, Keycloak down and its Secrets missing | **0/3** (Coder does not start, no password admin) | **3/3** |
| Live conformance (`live.py`, in the air gap) | – | **76/76** |
| Live rollback to pure upstream Coder and forward (kind) | – | **4/4** |
| Rollback on a copy of the development database | – | **7/7** |
| Load: ~1,050 dashboard tabs, 8 minutes | – | **0 errors** of 157,626 requests, worst p95 0.28 s |
| Browser: egress, pages, memory soak (Minikube) | – | 15/16[^2]; heap +0.3 MB over 8 min |
| Unit: `go test` on the 24 packages the fork changed, vitest (4,682 tests) | – | all fork-caused failures fixed; left: upstream's own (see 7) |

[^1]: 36/39 in the run itself. The three failures were the test's: it sent the Keycloak user's session cookie.
    Through Coder's proxy, as the admin, all four apps answer 200; step 8 is fixed.
[^2]: The failure was the test's (it checked the sign-in title before it rendered); fixed.

## 1. A self-contained deliverable for an air gap

| Finding (1.27.2) | Impact in an air gap | 1.28.0 |
|---|---|---|
| The repository alone cannot install: the three custom images (the fork's Coder, the workspace image, image tools) are on no registry, only in the release bundle | none if the release bundle is used; the latest release was 1.24.1 until 1.27.2 was published during this check | 1.27.2 published (2 parts + checksums); every release must publish its bundle |
| code-server and File Browser downloaded at every workspace start (`code-server.dev`, `raw.githubusercontent.com`) | two of the workspace's apps never start, and the workspace never becomes "ready" (its readiness waits for the apps' health checks) | both preinstalled in workspace image 1.8.0, pinned by SHA-256, checked offline at image build |
| The push Job's CLI was `ghcr.io/coder/coder:latest` (floating; v2.38.0 against the fork's server) | a re-mirrored `latest` changes the CLI under you | Coder's own image (same binary as the server); the floating image dropped (244 MB smaller) |
| The image builder's registry crash-looped on every fresh install (garbage-collect fails on an empty volume) | Templates › Images cannot build anything on a new deployment | skipped on an empty volume |
| Last air-gapped end-to-end run: 1.5.0, 22 releases earlier; step 8 only printed app health | regressions like the one above went unnoticed | harness scripted (`setup.sh`), step 8 asserts app health, steps 9–10 added; run on 1.27.2 and 1.28.0 (below) |

Checked and fine in 1.27.2:
- every image the chart runs is pinned by digest and bundled;
- telemetry, update checks, STUN, trial and GitHub login are removed or off;
- the dashboard makes no request outside the domain (30 pages crawled, 0 external requests);
- the Terraform providers are mirrored in the Coder image.

**Air-gapped end-to-end runs** (`development/tools/airgap-e2e/`): a kind cluster with all non-private egress
rejected; the bundle extracted on the "connected" side, then carried across. Every image loaded from `images/`
into an empty Docker and pushed to the registry ("11 loading", none pulled).

* **1.27.2:**
  - steps 1–6 passed;
  - in step 7 the platform service's image registry crash-looped (its garbage-collect step fails on an empty
    volume: **the image builder never works on a fresh install**), and Argo CD stayed Degraded;
  - step 8 then showed the consequences in 2: no admin and a Keycloak user as owner.
* **1.28.0:**
  - Argo CD Synced/Healthy in 297 s, and `seed-builder` seeded the builder's base;
  - step 8 39/39: code-server, File Browser, Desktop and marimo all healthy with no internet, and the Keycloak user
    a normal member;
  - steps 9 and 10 passed.

Fixes to the harness itself:
- `setup.sh` scripts the one-time setup;
- etcd and the test registry run in memory, because a busy host made the control plane crash-loop;
- teardown waits for namespaces, and removes the stale metrics APIService;
- metrics-server on kind needs `kubeletInsecureTLS`, as DEPLOY.md says for kind.

## 2. Coder without Keycloak, or before it is set up

| Finding (1.27.2) | Impact | 1.28.0 |
|---|---|---|
| Upstream Coder fetches the OIDC issuer's discovery document at startup and **exits** if it can't. The chart always configures an issuer | while Keycloak is not provisioned or is down, Coder crash-loops: **nobody can sign in, owners with passwords included** | a Keycloak issuer gets its standard endpoints without discovery: Coder starts, password sign-in works, Keycloak sign-in works once it answers. Other OIDC providers: password-only, then a clean restart when they answer. Tested: unit tests, a local server against an unreachable issuer, step 10 on kind |
| Under Argo CD the admin bootstrap and the template push were PostSync hooks, which wait for every resource to be Healthy; an unready metrics API (metrics-server unable to reach the kubelets) held them back | no admin account, no template, and **whoever signs in first with Keycloak becomes the owner** (upstream's first-user rule) | Sync hooks in waves 3–4, metrics-server in wave 5; and Coder refuses Keycloak sign-ins while it has no user at all (`CODER_PLATFORM_FIRST_OWNER=bootstrap`) |
| The Coder pod needs Keycloak's two Secrets to exist | the pod cannot even start before Keycloak is set up | both optional |
| `disablePasswordAuth: "true"` blocks every password, owners included | with Keycloak down, nobody signs in | documented: keep `"false"` until a Keycloak sign-in has worked (DEPLOY.md, Step 5) |

## 3. Minikube features on EKS

EKS itself was not available for this check. Instead:
- the kind cluster stands in for a non-Minikube cluster: containerd instead of Docker, no node access, a separate
  registry, egress blocked;
- the chart was rendered and checked with the EKS example values.

| Feature | On EKS | Status |
|---|---|---|
| Workspaces' home volumes | no StorageClass was set; EKS clusters may have no default class: volumes Pending, workspaces never start | **fixed**: `coder-workspace.storageClass`, set by `./make --deploy` and the example files; existing homes never replaced |
| Image builder volumes | same | **fixed** (`imageBuilder.registry/files.storageClass`) |
| Image builder base image | BuildKit pulled it from `global.registry`, which needs credentials: ECR with node roles gives a pod none | **fixed**: the builder's own registry is seeded (`make --deploy`, `mirror-images.sh seed-builder`); fallback kept |
| Built images on nodes (`localhost:5000` through the node proxy) | containerd, as on EKS | tested on kind (step 9) |
| BuildKit rootless | needs unprivileged user namespaces and unconfined seccomp/AppArmor on the build pods | works on kind; **check on your nodes**: `sysctl user.max_user_namespaces` > 0 (Bottlerocket disables them), and no Pod Security "restricted" on the `coder` namespace |
| metrics-server | the chart installs its own only when the cluster has none | fine (EKS add-on or the bundled one) |
| Argo CD installs | an unready metrics API used to block the admin bootstrap (see 2) | **fixed** by the sync waves |
| Admins' kubectl with Keycloak | EKS checks tokens from its control plane, so the issuer must be reachable from AWS's network | **open**: with a Keycloak only on the private network, it cannot work on EKS. Options: make the issuer reachable for EKS, or run an in-cluster OIDC proxy (Pinniped, kube-oidc-proxy; images to add to the bundle) |
| Load balancer, ECR, S3 backups | AWS APIs in an air gap need VPC endpoints (`ecr.api`, `ecr.dkr`, S3 gateway, `elasticloadbalancing`, `sts`) | documentation item |
| Node architecture | every image is amd64 | no Graviton |

## 4. The image builder without internet

Step 9 on 1.28.0, in the air gap with no apt mirror, **12/12**:
1. The package check said "not available". It took 138 s in this run; 1.28.0 now cuts that wait to seconds.
2. An uploaded `.deb`, an installation script, dotfiles, hardening and FIPS settings all applied.
3. BuildKit rootless built the image, and it was pushed to the builder's registry.
4. trivy scanned it with the bundled database (3,158 findings graded), and the checks ran.
5. GNOME and an apt package were refused up front, with the reason.
6. The node then pulled the image through `localhost:5000` and ran it (containerd, as on EKS), with everything the
   build put in.

| Finding (1.27.2) | 1.28.0 |
|---|---|
| A GNOME build (or one with apt packages) with no apt mirror failed halfway through | refused before it starts, saying why and what to do |
| On EKS the base image needed registry credentials | builder's own registry seeded (above) |

Works offline with no mirror: uploaded `.deb` files, installation scripts, dotfiles and shell configuration,
hardening, FIPS-aligned settings, XFCE or no desktop, the scan (trivy with the bundled database, image checks, FIPS
readiness), and S3 backups to an S3 endpoint in the network. Needs a mirror: apt packages and GNOME. Ages: the
vulnerability database; load a newer one with `build-security-data.sh`.

## 5. Under heavy load

| Finding (1.27.2) | Impact | 1.28.0 |
|---|---|---|
| Every dashboard page waits for `/__coder-ui/boot.js` from the platform service (a render-blocking script) | an overloaded or hung platform service freezes every page for everyone | Coder's proxy gives it 3 s, then serves an empty script: the dashboard starts with its defaults |
| The platform service's session cache was cleared whole past 2,000 entries | above ~2,000 sessions every request goes back to Coder's API | least-recently-used, 20,000 entries |
| Quota and schedule checks on workspace create/start ask the platform service | they fail open (create allowed), after up to 10 s if it hangs | documented |

**Measured** (1.28.0, kind, `load.py` in a pod): 100 developers and 5 admins at ×10, about 1,050 open tabs
polling as the dashboard does, for 8 minutes.

| | |
|---|---|
| Requests | 157,626 (328 per second), **0 failed** |
| Latency | p50 5–113 ms; worst p95 0.28 s (quota report), p99 0.54 s |
| Restarts | none |
| Memory | platform service 42 → 50 MiB (limit 512 MiB); Coder 115 → 729 MiB (limit 4 GiB) |

**Browser:** an 8-minute soak each of the workspace page (1 s metrics) and the HUD.
- The JS heap grew 0.3 MB on each (22.7 → 23.1 MB, 19.7 → 20.0 MB), and the DOM was flat.
- No request left the domain on 16 pages, and no page threw.

For larger teams, Coder itself scales out (more replicas); the platform service is one replica, and holds this load
at a fraction of its limits.

## 6. Rollback to upstream Coder

| Finding (1.27.2) | 1.28.0 |
|---|---|
| The fork adds **no** database migration (schema = upstream's at the base, 000611) and stores nothing in Coder's tables that upstream does not understand | confirmed |
| No published upstream release can open the fork's database: v2.38.0 stops at 000605; the next release (v2.39.0) will | rollback image in the bundle: pure upstream at the fork's base, with the provider mirror |
| No documented procedure | `development/coder-fork/ROLLBACK.md` |

**Tested:**
* **On a copy of the development database** (`rollback.sh`, 7/7): upstream starts, signs in the password admin, sees
  exactly what the fork sees (users, templates and versions, workspaces, builds, apps, SSH keys), and leaves the
  schema as it was. The fork then runs on it again.
* **Live on the test cluster** (`rollback-live.sh`, 4/4):
  - Argo CD switched the running deployment to upstream: the admin signs in, both workspaces are there, the
    running workspace's agent (built by the fork) reconnects, and all its apps stay healthy;
  - switching back to the fork works the same way.

After a fork update to a newer upstream (migrations are forward-only), the rollback image must move with it:
`UPSTREAM.md`, step 5.

## 7. Test suite

`development/tools/verify/` (README there), plus the air-gapped e2e (`development/tools/airgap-e2e/`).

| Suite | Result |
|---|---|
| `go test` on the 24 packages the fork changed | 23 of 24 pass. Fork-caused failures, all fixed: upstream's user, member and group filter tests created GitHub users through the API, which the fork removed (fixtures now make them in the database), and a SpendPage test expected the removed trial offer. Left: `./cli`'s leak check, an upstream shutdown race (`TestServer/Logging`) that fails the same way in pure upstream when run alone, and only shows because the fork's package runs faster |
| Dashboard vitest (4,682 tests) | 4,673 pass. Left: 8 upstream time-of-day tests (`timeGroups`, `SpendPage`) that fail identically in pure upstream at the test hour (01:00–02:00 EDT) |
| New tests | OIDC startup fallback (`cli/platform_oidc_internal_test.go`), the boot-script time limit (`TestPlatformServiceRoutes`), the first-owner guard (`TestPlatformFirstOwnerByBootstrap`), the platform service (`platform_unit_test.py`: cache, admin sync, offline refusals, base seeding) |
| Deleted upstream tests | only those of removed features (telemetry, the update check, trials, GitHub login) |

## 8. Features over Community Edition

[`FEATURES.md`](FEATURES.md).

## 9. Following upstream

[`development/coder-fork/UPSTREAM.md`](../development/coder-fork/UPSTREAM.md).
- A trial merge of 10 days of upstream (189 commits, migrations 612–618) conflicts in 14 files.
- The process: follow release tags, merge rather than rebase, then pass the verification gate (the full upstream Go
  suite, vitest, the e2e, and the live, UI, rollback and load suites) with no regression against the previous
  release's report.
