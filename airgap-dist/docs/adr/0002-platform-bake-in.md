# ADR-0002: Bake the platform's workspace features in – no Terraform injection

**Status:** Accepted (2026-10-20, the platform owner: the admission webhook for the pod's pieces; the bake-in before
Platform HA phase 3)
**Date:** 2026-10-20
**Deciders:** the platform owner (user187x)
**Scope:** the fork (`user187x/coder`, Community/AGPL code only), the platform service and this repository's chart

## Summary

Five platform features reach a workspace today as Terraform text: Coder's template decorator
(`coderd/templatedecorator`) splices sections of the DEFAULT template into every other template's archive whenever a
provisioner job is acquired. The features are:

- **metrics** – the workspace's and the cluster's metrics;
- **Lock Down** – egress locked to Coder;
- **certificates** – the user's certificate installed;
- **Cloud Drive** – the user's drive and what is shared with them;
- **code-server HA** – the IDE relay.

The owner's directive: *"bake-in all of the global script that gets automatically injected into the terraform code so
it doesnt need to get applied at the terraform level"*.

We split each feature by where it lives:

- **What runs in the agent (scripts and metadata) is delivered by coderd.** When a build completes, coderd adds the
  platform's scripts and metadata items to the workspace's agent as database rows, beside the template's own. The agent
  receives them in its manifest, as any template's.
- **What changes the pod (init container, volumes, mounts, sidecar, annotations) is added by a mutating admission
  webhook.** It is served by the platform service's image and edits workspace pods as Kubernetes creates them.

Terraform no longer carries any of it. A plain template – Coder's own Kubernetes example – gets every feature. The
decorator, the `# platform:begin` sections and the template builder's strip-and-redecorate step go away.

## Context

### What the decorator does today

The decorator (`coderd/templatedecorator/decorator.go`) runs at provisioner job acquisition
(`provisionerdserver.go:1001`): imports, dry runs and builds alike.

- It parses the job's HCL and finds the agent, its workload and its container.
- It inserts each feature's sections at their placements: top level, agent, pod metadata, pod spec, container.
- It rewrites `coder_agent.main` and the image expression, and appends a `requires` block of variables and data
  sources with the base template's values.
- It is on while `CODER_TEMPLATE_BUILDER_BASE_TEMPLATE` names the base template. `# platform:no-decorator` opts a
  template out; a feature the template already has (by marker) is skipped.

What each feature needs (survey, 2026-10-20):

| Feature | In the agent (scripts, metadata) | In the pod | Context |
|---|---|---|---|
| metrics | 9 metadata items: `0_cpu_usage` … `8_net_io`, run by `metadata.sh` | – (`CODER_HOME_DISK_SIZE`, outside the sections) | none |
| Lock Down | script "Lock Down" (start, blocks login): `lockdown.sh start file:/etc/coder-lockdown/<ws id>` | init container `lockdown` (the agent's image, root, NET_ADMIN + NET_RAW), ConfigMap `coder-lockdown` mounted at `/etc/coder-lockdown` | workspace id, Coder's host |
| certificates | script "Certificates" (start, blocks login): `certificates.sh` for the owner | – | owner name |
| Cloud Drive | script "Cloud Drive" (start, blocks login) with the CLI and FileBrowser helper; metadata `9_cloud_drive` | PVC `coder-safe-<owner>` (or the source's) at `/mnt/cloud-drive`, the peers' PVCs, `coder-isos`, the downward-API file `/etc/platform/cloud-drive`, annotation `platform.coder/cloud-drive` | owner id, workspace id, the state in ConfigMap `coder-cloud-drive` |
| code-server HA | – (the base `startup.sh` reads `CODER_CODE_SERVER_HA`) | sidecar `code-server-relay` (`csha.py front`), env, the database CA | per-template switch, the agent token, the workspace image |

### Why it has to go

- **Text surgery on someone else's Terraform.** Every new template shape is a new way to fail, for example:
  - a second agent;
  - a `kubernetes_pod` instead of a Deployment;
  - a dynamic env block;
  - a variable whose name clashes with ours.

  A failure is logged and the template runs undecorated, silently without Lock Down.
- **The template is not what runs.** What an admin reads in the template's source is not what Terraform applies.
  Plans, diffs and Terraform errors point at text nobody wrote.
- **Coupling.** The template builder strips the sections from the base template (`composePlatform`). Its templates
  then depend on the decorator. DATAFLOW depends on the base template's sections by marker.
- **The directive.** The owner wants these features to be the platform's, not the template's.

### Constraints

- **Community code only.** Nothing under `enterprise/` is read, copied or called. The platform image is the AGPL build
  (ADR-0001, phase 3 step 1).
- **Air-gapped.** Nothing fetched at workspace start. The scripts stay in the chart, as today.
- **Multi-node and several Coder replicas** (ADR-0001). The webhook must not be a single point of failure for
  workspace starts.
- **Lock Down is a security control.** A pod must not start without it while its workspace is locked down.
- **No Traefik body rewriting, stock Traefik values** (the owner's rule). This design does not touch Traefik.

## Decision

### 1. The agent's pieces: coderd adds them when a build completes (fork, Go)

- **Hook.** `provisionerdserver.InsertWorkspaceResource` gains an option that only `completeWorkspaceBuildJob` passes.
  It carries the workspace and its owner.
  - For each top-level agent of a Kubernetes workload resource, coderd appends the platform's scripts to the agent's
    scripts before `insertAgentScriptsAndLogSources`. Each script gets its own log source, named and with an icon.
  - After the template's own metadata, coderd inserts the platform's metadata rows.
  - Imports and dry runs are untouched: a template version shows only what its author wrote.
- **Why rows, not the manifest.** Coder stores only what has a row:
  - `UpdateWorkspaceAgentMetadata` is UPDATE-only;
  - script timings have a foreign key to `workspace_agent_scripts`;
  - the dashboard names logs by their log source.

  Rows make the scripts, logs, timings, metadata, the dashboard and the platform service's own queries work unchanged.
- **The template wins.** A script whose display name, or a metadata item whose key, the template already defines is
  not added. A template that brings its own Lock Down, or the transition's decorated templates, are not doubled.
- **What is added comes from the chart, not the binary.**
  - The chart mounts a ConfigMap `coder-platform-agent` into Coder's pod. It holds the scripts (`metadata.sh`,
    `lockdown.sh`, `certificates.sh`, `cloud-drive.sh`, the Cloud Drive CLI, `filebrowser.sh`) and `agent.json`,
    which lists each script's display name, icon, `run_on_start` and `start_blocks_login`, and each metadata item's key,
    script, interval and timeout.
  - coderd reads the ConfigMap's directory at start and on change: `CODER_PLATFORM_AGENT_DIR`; empty means off.
  - The features ship with the chart, as their Terraform did. Coder does not have to be rebuilt to change a script.
- **The scripts take their context from the environment, not from templating.**
  - The agent already exports `CODER_WORKSPACE_ID`, `CODER_WORKSPACE_OWNER_NAME`, `CODER_WORKSPACE_NAME` and
    `CODER_WORKSPACE_AGENT_NAME` to every script.
  - The webhook adds what only the pod knows (§2): the Cloud Drive's mode, mount and shared items, as JSON in the
    annotation `platform.coder/cloud-drive-mounts`, which the downward API shows at `/etc/platform/cloud-drive-mounts`
    beside today's `/etc/platform/cloud-drive`.
  - A pod recreated without a new build, such as a ReplicaSet replacing a pod, is mutated again from the current state.
    The script reads that state, so it cannot disagree with the pod. Today's build-time values could.
- **Per feature on or off.** `agent.json` holds the deployment's choice: `global.userStorage` decides the Cloud Drive,
  and Lock Down's own switch decides Lock Down. Lock Down's script is harmless where the workspace is not locked down:
  it reads its ConfigMap entry and finds none.

### 2. The pod's pieces: a mutating admission webhook (platform service image, Python)

- **What it watches.** Pods, on CREATE, in the workspace namespace only:
  - `namespaceSelector` on `kubernetes.io/metadata.name`;
  - `objectSelector` `app.kubernetes.io/name=coder-workspace` and `com.coder.workspace.id` exists. These are the
    labels of Coder's Kubernetes example and of our templates.
  - Pods, not Deployments, so Terraform never sees a drift.
- **The agent's container.** The container whose env holds `CODER_AGENT_TOKEN` (as a value or from a Secret). Failing
  that, the container named `dev`, then the first. The platform service's code that names `dev` (`lockdown.py`,
  `safe.py`, `kexec.py`) learns the same rule.
- **What it adds (a JSON patch).** Each piece is skipped when the pod already has one of that name: decorated pods
  during the transition, or a template that brings its own.
  - **Lock Down:** the `lockdown` init container from the agent container's image, the `coder-lockdown` volume and its
    mount. Added to every workspace pod, as today: whether a workspace is locked is decided at run time from the
    ConfigMap.
  - **Cloud Drive** (with `global.userStorage`): the annotation, the `safe` / peer / `isos` volumes and mounts, the
    downward-API file. They are computed from ConfigMap `coder-cloud-drive`, which the platform service already writes
    (`safe.py`). The webhook reads its own process's copy, so there is no lookup per pod.
  - **code-server HA** (per template): the `code-server-relay` sidecar, its env (the agent token copied from the agent
    container), the database CA volume and `CODER_CODE_SERVER_HA=1` on the agent container. The template asks for it
    with the pod annotation `platform.coder/code-server-ha: "on"` – a flag, not injected code – so the webhook needs no
    database lookup. A switch in the template's settings can set it later.
  - **Base pieces** a plain template lacks:
    - the `trust-local-ca` init container with the CA bundle (`tls-ca`), which the agent needs on a private CA;
    - `CODER_HOME_DISK_SIZE`: the size of the claim mounted at `/home/coder`, for the Disk metric.
- **Its own Deployment.** `coder-platform-webhook` runs the same image with `python3 /app/webhook.py`.
  - It is stateless. 2 replicas with a soft anti-affinity and a PodDisruptionBudget (`minAvailable: 1`), behind its
    own Service.
  - It is not in the platform service's pod. That pod is a single replica with background loops, and its restart
    must not block workspace starts.
- **TLS.** The chart makes the webhook's CA and serving certificate (`genCA` / `genSignedCert`), kept across upgrades
  with `lookup` like `secrets.generateTls`, and puts the CA in the configuration's `caBundle`. No cert-manager.
- **Failure policy.**
  - `failurePolicy: Fail`, `timeoutSeconds: 5`, `reinvocationPolicy: Never`. While no replica answers, workspace pods
    are refused and the Deployment retries. A pod never starts without Lock Down.
  - The narrow selectors keep the blast radius to workspace pods. The webhook's own pods, Coder and the platform service
    are never selected.
  - A webhook bug fails safe: workspaces don't start. It does not fail open.
- **RBAC.** It reads the ConfigMap `coder-cloud-drive` and the workspace's home claim in the workspace namespace. It
  writes nothing.

### 3. The decorator goes, in two steps

1. **The release that ships the bake-in.**
   - The chart turns the bake-in on: `CODER_PLATFORM_AGENT_DIR`, the webhook.
   - It turns the decorator off: `CODER_TEMPLATE_BUILDER_BASE_TEMPLATE` empty.
   - The DEFAULT template loses its `# platform:begin` sections and its `requires`-only variables. DATAFLOW keeps its
     own resources.
   - The template builder composes without stripping.
   - Workspaces built before keep their decorated build until their next start. A workspace's start is a build, so
     it changes over then. Mixed pods are safe, because both sides skip what is present.
2. **The release after.** The decorator's package, its endpoints (`/templatebuilder/decorator`, `/materialize`), its
   flag and the chart's `platform.decorated` are deleted, with their tests and the Argo CD decorator install
   (`global.decorator`). That install gets the same two parts: the ConfigMap and the webhook.

## Options considered

### A: Keep the decorator (status quo)

| Dimension | Assessment |
|---|---|
| Complexity | High, and growing with every template shape |
| Correctness | Fails open: an undecorated template runs without Lock Down |
| Fit with the directive | None |

**Pros:** works today; nothing to build.
**Cons:**
- text surgery on authors' Terraform;
- what runs is not what the author wrote;
- the template builder's strip-and-redecorate;
- fails open.

### B: Everything at manifest time in coderd (no rows)

coderd would add the scripts and metadata to the agent's manifest only.
**Cons:**
- metadata values are UPDATE-only, so they would never be stored;
- script timings need a script row;
- logs would show no source.

Making it work means inserting the rows lazily, which is option C with more moving parts. **Rejected.**

### C: Rows at build completion + an admission webhook (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Medium: one hook in provisionerdserver; one stateless webhook |
| Correctness | Fails safe (pods refused while the webhook is down); the template wins on clashes |
| Scalability | Per build: a few rows. Per pod: one admission call, no lookups for Lock Down or the Cloud Drive |
| Team familiarity | provisionerdserver and the platform service are both ours to change already |

### D: A Terraform module the templates include

**Rejected.** It is still applied at the Terraform level, which the directive rules out, and every template must
include it.

### E: The webhook inside the platform service's pod

**Rejected.** It is one replica with long background loops, so a crash or a slow loop would block every workspace
start under `Fail`. Under `Ignore`, pods would start without Lock Down.

## Trade-off analysis

- **Fail versus Ignore.** `Fail` makes the webhook part of the workspace start path. Two stateless replicas and a
  PodDisruptionBudget make that cheap. `Ignore` would make Lock Down best-effort, which a security control cannot be.
- **Chart-delivered scripts versus embedded.** Embedding would version the scripts with Coder's image. Delivering them
  from the chart keeps them where they are maintained and tested today (`charts/coder-workspace/files/scripts`). The
  `-layer` update then ships them as before, with no Coder rebuild per script change. The cost is one directory flag in
  the fork.
- **Run-time context versus build-time values.** Reading the Cloud Drive's state in the script, as the webhook wrote it,
  costs a JSON file. In exchange the pod and the script can never disagree: a pod re-created by its ReplicaSet gets
  today's mounts.

## Consequences

- **Easier:**
  - any Kubernetes template gets the platform's features, Coder's example included;
  - templates read as what runs;
  - the template builder composes plainly;
  - DATAFLOW stops depending on markers;
  - a failure refuses a pod visibly instead of running it without Lock Down.
- **Harder:**
  - the workspace start path now includes the webhook;
  - an admission webhook is new to the chart (certificates, an upgrade order: the webhook's Deployment before its
    configuration).
- **Revisit:**
  - the per-template code-server HA switch's home and UI;
  - whether `certificates` and `metrics` should move into the workspace image's own startup.
  - Phase 3 of ADR-0001 runs after this, so the mesh is built on the slimmer templates.

## Action items

1. [ ] Fork: `CODER_PLATFORM_AGENT_DIR` (codersdk deployment option, off by default), its loader (`agent.json` + the
       scripts, re-read on change) and the `InsertWorkspaceResource` option. Tests: the rows inserted, the template
       winning on a clash, imports and dry runs untouched.
2. [ ] Fork: the agent-container rule for templates with several agents. Only agents of Kubernetes workload resources
       get the platform's pieces.
3. [x] Platform service: `webhook.py` (admission review in, JSON patch out). Unit tests on:
       - Coder's Kubernetes example pod;
       - the DEFAULT pod;
       - an already-decorated pod (no change);
       - a `kubernetes_pod`;
       - a pod with two containers.
4. [ ] Platform service: `lockdown.py`, `safe.py` and `kexec.py` find the agent's container by the new rule.
5. [ ] Chart:
       - ConfigMap `coder-platform-agent`, built from `charts/coder-workspace/files/scripts`;
       - the webhook's Deployment, Service, PodDisruptionBudget, certificates and MutatingWebhookConfiguration;
       - `CODER_PLATFORM_AGENT_DIR`;
       - the decorator off.

       Static checks for each.
6. [ ] Templates: DEFAULT without its sections; `cloud-drive.sh` reads `/etc/platform/cloud-drive-mounts` when the
       template gave it no values.
7. [ ] Prove it:
       - a plain upstream Kubernetes template on the dev cluster gets Lock Down, the Cloud Drive, metrics and
         certificates;
       - the live suites;
       - the one-step kind e2e;
       - the webhook's replicas killed during a start: the start waits, then succeeds; no pod runs without Lock Down.
8. [ ] The release after: delete the decorator (§3, step 2).

## Compliance

All code is Community/AGPL code in the fork and in this repository. Nothing under `enterprise/` is read, copied, called
or changed, and no license check is touched.
