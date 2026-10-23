# ADR-0001: Platform HA – an active/active Coder control plane of our own

**Status:** Accepted (2026-10-20, the platform owner)
**Date:** 2026-10-20
**Deciders:** the platform owner (user187x)
**Scope:** the fork (`user187x/coder`, Community/AGPL code only) and this repository's chart

## Summary

Coder Community runs one replica well and several badly. Each replica keeps its own in-memory tailnet coordinator
and its own DERP relay, with no mesh between them. A client on replica A therefore cannot reach a workspace whose agent
is connected to replica B. Coder Enterprise fixes this behind its `high_availability` entitlement with:

- a PostgreSQL coordinator;
- a DERP mesh;
- a replica registry.

All three are in `enterprise/`, whose license forbids circumventing the license key. Our own code-server HA (the
replicator) keeps the IDE alive, but it sits behind the single Coder replica and the workspace pod. It also runs out of
database connections at about 35 workspaces.

We will build **Platform HA** in the fork's Community code, without touching `enterprise/`. It is an active/active
Coder control plane:

- **Replica registry with fencing.** Each replica holds a lease in PostgreSQL with an epoch. A replica that cannot renew
  its lease stops serving.
- **Mesh Coordinator.** It implements Coder's `tailnet.Coordinator`. Each peer lives on the replica it connected to. A
  directory in PostgreSQL records only where peers are, written on connect and disconnect. Node updates travel between
  replicas directly, over streams opened only between replicas that share tunnels, never through the database.
- **DERP cells.** A cell is a group of up to 5 replicas: one DERP region, fully meshed. More cells are more regions, and
  peers reach each other through each one's home region, the way Tailscale works. Capacity grows by adding cells, with
  no N² mesh.
- **Kubernetes-native lifecycle.** It uses readiness tied to the lease, graceful drain on SIGTERM so rolling updates
  move sessions rather than drop them, PodDisruptionBudgets, and topology spread.

We will reach it in phases:

- **Phase 0:** infrastructure HA, with no code change.
- **Phase 1:** the replica registry.
- **Phase 2:** an active/standby Coder, which is HA soon at low risk.
- **Phase 3:** active/active.
- **Phase 4:** the platform service and storage.
- **Phase 5:** code-server HA v2, which removes the replicator's three limits.
- **Phase 6:** the HA layers in the cluster network view.

Every phase is opt-in. With it off, the platform behaves exactly as today. A deployment that buys Enterprise HA uses
Coder's, and ours stands aside.

## Context

### What runs today

| Component | Copies | What its failure does |
|---|---|---|
| Coder (`coder` Deployment) | **1** | The dashboard, every workspace connection (terminal, apps including code-server, SSH, port forwarding) and builds stop until the pod restarts. |
| Database (CloudNativePG) | 2 instances | The operator promotes the replica, and Coder reconnects through `-rw`. |
| Gateway (Traefik) | 1 by default | Nothing reaches the cluster. |
| Platform service (`coder-ui-updates`) | **1** (SQLite on a ReadWriteOnce volume) | Health, Images, Cloud Drive, Lock Down and the other platform views are down. |
| Image registry, MinIO | **1** each (ReadWriteOnce) | Image pulls and builds, and the Cloud Drive, fail. |
| code-server HA (replicator) | 2 operators, 1 active | See below. Off for both templates, so unused. |
| Workspaces | 1 pod and 1 ReadWriteOnce home volume each | Losing a node loses the workspace until its volume can be attached elsewhere. |

### Community Coder's limits when scaled (from the fork's code)

1. **The coordinator is in memory, one per replica.** Coder's default is `tailnet.NewCoordinator`
   (`coderd/coderd.go:437`). Without the HA license, Enterprise's code installs exactly that again at startup
   (`enterprise/coderd/coderd.go:904`) and stops its DERP mesh (`:906`). A peer is known only to the replica it
   connected to.
2. **There is one embedded DERP region with one node: the access URL** (`cli/server.go:657-669`). Behind a load
   balancer, an agent and a client reach different replicas' DERP servers. With no mesh, their packets never meet.
   STUN is off in the air gap, so all traffic is relayed.
3. **The registry, mesh and HA coordinator are Enterprise code.** `enterprise/replicasync`, `enterprise/derpmesh` and
   `enterprise/tailnet` (pgcoord) all live under `enterprise/`. `LICENSE.enterprise` says: "You may not move, change,
   disable, or circumvent the license key functionality". We use none of that code, change none of it, and copy none
   of it.
4. **What already works across replicas:**
   - PostgreSQL pubsub (`coderd/database/pubsub`, AGPL);
   - background jobs, which take database locks (`dbpurge.go:135`, `lifecycle_executor.go:246`);
   - provisioner jobs, which come from the database queue;
   - notifications, which use leases.
5. **The hooks we need exist in Community code:**
   - the `tailnet.Coordinator` interface;
   - `api.TailnetCoordinator` (an atomic pointer that ServerTailnet, agents and clients all use);
   - `api.DERPMap()`;
   - the DERP server (`derp.Server`, from BSD-licensed tailscale, with `SetMeshKey`, `AddPacketForwarder` and the
     `derphttp` mesh client);
   - the mesh key in the database (`GetDERPMeshKey`).

   Coder's coordinator conformance tests (`tailnet/test/cases.go`) accept any `CoordinatorV2`.

### Our code-server HA today: what it covers, where it stops

Its logic is right: `csha_db_test.py` passes against a real PostgreSQL, with failover, a new generation and fencing.
It stops short in three places:

- **Coverage.** Every path to code-server runs browser → Coder's app proxy → the workspace agent → the front relay in
  the workspace pod. It therefore cannot outlive the single Coder replica or the workspace pod. The instance is pinned
  to the workspace's node, because the home volume is ReadWriteOnce. A takeover in another cluster has no home files and
  is reached through the dead cluster's agent.
- **Database connections.** Each relay keeps a pool connection open, so each HA workspace holds at least 2. With
  `max_connections` at 100 and 21 in use, that is about 35 workspaces, or about 20 with 3 Coder replicas.
- **The operator.** One active operator per cluster reconciles every workspace in turn, every 5 s. Each workspace costs
  about 2 Kubernetes API GETs and 1 database write (polling, no watch). Its heartbeat is written in the same loop. At
  around 1,000 workspaces a round takes longer than the 45 s heartbeat TTL, and other clusters would take over healthy
  workspaces.

The patterns are the right base and are reused below: PostgreSQL as the source of truth, leases with compare-and-set,
generations, and fencing.

### Constraints

- **No change under `enterprise/`, and no license circumvention.** If a valid `high_availability` license is present,
  Coder's own HA takes precedence and ours stands aside (see Compliance).
- **Do not break anything.** Every phase is behind a chart value, off by default. With it off, the manifests, the
  binaries' behaviour and the database are as today. code-server HA, the Cloud Drive, Lock Down, the template
  decorator and every platform view keep working throughout.
- **Air-gapped.** No external services; all traffic is relayed by DERP.
- **Kubernetes design patterns:**
  - stateless Deployments with probes;
  - PodDisruptionBudgets and topology spread;
  - leases for leadership;
  - EndpointSlices for membership;
  - Gateway API for routing;
  - NetworkPolicies for the mesh;
  - graceful termination.
- **No sticky sessions.** The design must be correct for any replica receiving any request.

### Requirements

| | Target |
|---|---|
| Loss of a Coder replica | New connections are unaffected: the Service routes away. Existing tunnels re-coordinate in **< 10 s**, and the agent's terminal sessions resume (reconnecting PTY). |
| Rolling update or node drain | **No session is dropped without a reconnect.** Sessions are drained to the other replicas before the pod stops. |
| Loss of a zone (3 zones) | The control plane stays up. Workspaces in the lost zone are down until their volumes can move (see Workspaces). |
| Database primary failure | Coder pauses for about 10–30 s while CloudNativePG promotes. Phase 0 makes the replication synchronous, so **no committed data is lost**. |
| Scale | Linear in cells. The guide is ≤ 5 replicas per cell (bounded mesh), with cells added for more. No component's cost grows with the square of the replica count. |
| Database cost | O(connects), not O(node updates). Relays and operators use short calls through a pooler. |

## Decision

Build Platform HA in the fork's Community code, delivered in the phases below. The core is an active/active control
plane, made of the replica registry, the Mesh Coordinator, DERP cells and a drain-aware lifecycle. The active/standby
mode of Phase 2 ships first as the low-risk step, and stays as a supported mode for small installs.

## Architecture

```mermaid
flowchart LR
  subgraph Users
    B[Browser / CLI / IDE]
  end
  subgraph Gateway[Traefik Gateway, 2+ replicas]
    R1[coder.example.com]:::r
    R2[cell-a.derp.example.com]:::r
  end
  subgraph CellA[Cell A: DERP region 901, full mesh]
    C1[coder-0<br/>MeshCoordinator + DERP]
    C2[coder-1<br/>MeshCoordinator + DERP]
    C3[coder-2<br/>MeshCoordinator + DERP]
  end
  subgraph PG[CloudNativePG, 3 instances, sync replica]
    REG[(platform_ha.replicas<br/>platform_ha.peers)]
  end
  A1[workspace agent]
  B --> R1 --> C1 & C2 & C3
  B -. DERP .-> R2
  A1 -- rpc + DERP --> R1
  C1 <-. coordination streams .-> C2 <-. .-> C3
  C1 <== DERP mesh ==> C2 <== ==> C3
  C1 & C2 & C3 --- REG
  classDef r fill:#eef,stroke:#88a
```

### 1. Replica registry and membership (`coderd/platformha/registry`)

- **Its lease.** Each Coder replica, on start, inserts a row into `platform_ha.replicas`: `id`, `epoch` (from a
  sequence), `pod`, `pod_ip`, `cell`, `state` (`starting|ready|draining`) and `lease_expires`. It renews the lease every
  3 s, with a 10 s TTL, by compare-and-set on `(id, epoch)`. The heartbeat runs in its own goroutine, never in a work
  loop.
- **Self-fencing.** A replica that fails to renew before the TTL turns its readiness off. It closes its coordination
  streams and its peers' sessions, so they reconnect elsewhere. It never serves on a lease it does not hold.
- **Two views of membership.** Each replica watches the headless Service's **EndpointSlices**, which change fast and
  follow readiness, and also reads the registry, which is authoritative and carries the epochs. A peer is dead when its
  lease has lapsed **or** its endpoint went away with the pod terminating. Failure detection takes about the readiness
  period, never more than the TTL.
- **GC.** Rows whose lease lapsed long ago are removed by whichever replica holds a database lock (the existing
  `TryAcquireLock` pattern).

### 2. Mesh Coordinator (`coderd/platformha/meshcoord`, implements `tailnet.Coordinator`)

- **Local core.** A peer (agent, client, or a replica's own ServerTailnet) is served by the replica it connected to.
  Each replica runs Coder's in-memory coordination logic for its local peers (the AGPL core, wrapped, not modified).
- **Directory.** On a peer's connect the replica upserts
  `platform_ha.peers(peer_id, replica_id, replica_epoch, seq, updated_at)`. The write is a compare-and-set on `seq`,
  so the newest connection wins, including a peer resuming on another replica with its resume token. The row is deleted
  on disconnect. That is **two writes per connection, and none per node update** (pgcoord writes and NOTIFYs every
  update).
- **Remote tunnels.** When a local peer adds a tunnel to a peer on another replica:
  1. The replica looks up the destination: in its cache first, then the directory.
  2. It opens, or reuses, **one multiplexed stream to that replica**. This is dRPC over mutual TLS on the pod IP, with
     the mesh key as a second factor, and NetworkPolicy limits the port to Coder pods.
  3. It sends `TunnelAdd{src, dst, srcNode}`.
  4. The owning replica treats the source as a remote proxy peer in its core, and node updates flow both ways.
     Streams exist only between replicas that share tunnels.
- **Moves and failures:**
  - **A peer moves:** a reconnect elsewhere bumps `seq`. The old owner learns of it, through the directory or a
    "peer moved" message, and the tunnels re-point to the new owner.
  - **A replica dies:** its peers' rows are stale, and readers ignore rows whose replica's lease lapsed. Tunnels to them
    get `PEER_LOST`, which Coder's clients already handle by retrying. The peers reconnect elsewhere, and re-coordinate
    within one reconnect backoff.
- **Precedence.** The Mesh Coordinator is installed through a factory in Community `tailnet.NewCoordinator`, set at
  startup when `platformHA.mode=activeActive`. That one function is where both Coder's default and Enterprise's
  unlicensed fallback get the Community coordinator, so `enterprise/` stays untouched. If the `high_availability`
  entitlement is enabled, Enterprise installs its own coordinator. Our factory is then never called, and our mesh and
  registry report themselves inactive.

### 3. DERP cells (`coderd/platformha/derpcell`), the data plane

- **A cell is one DERP region.**
  - The cell's replicas form a full mesh with the tailscale `derphttp` mesh client and packet forwarders, keyed by the
    database mesh key, over pod IPs.
  - Each cell is reachable at its own hostname, `cell-<name>.derp.<domain>`, through its own Service and HTTPRoute.
  - With ≤ 5 replicas per cell, the mesh is at most 20 links.
- **More cells mean more regions.** Community `api.DERPMap()` composes three parts:
  1. the base map;
  2. the live cells, from the registry;
  3. Coder's `DERPMapper` (workspace proxies, when licensed).

  Clients get the updated map through Coder's existing DERP map updates. A peer sends to another through the
  receiver's home region, which is how Tailscale scales without a global mesh. The bandwidth across cells is paid only
  for pairs whose home regions differ.
- **Start with one cell.** A single cell (the default, `cell: a`) is today's one region with a mesh behind it. Adding a
  cell is a values change: a Deployment, a Service and a route.

### 4. Lifecycle: readiness, drain, rolling updates

- **Readiness** means three things together: the lease is held, the registry and EndpointSlice watchers are synced,
  and the DERP mesh is connected to the other replicas of the cell. A replica that is not ready receives no traffic.
- **Drain on SIGTERM**, from a `preStop` hook with `terminationGracePeriodSeconds: 120`:
  1. Set the state to `draining` and readiness to false, so the Service stops sending new traffic.
  2. Over 30–60 s, with jitter, close the local peers' coordination sessions with a "reconnect" status. Agents and
     clients reconnect to other replicas and resume, and their tunnels follow.
  3. Close the DERP connections last.
  4. Release the lease.
- **Rolling updates** use `maxSurge: 1, maxUnavailable: 0`. The PDB is `maxUnavailable: 1`.
  `topologySpreadConstraints` spread over zones, then nodes, with `whenUnsatisfiable: DoNotSchedule` for zones.

### 5. Data

A new schema, `platform_ha`, is created by the fork at startup, not as a Coder migration. The fork adds no Coder
migrations, so rolling back to upstream Coder stays possible. It has two tables:

- `replicas(id uuid pk, epoch bigint, pod text, pod_ip inet, cell text, state text, lease_expires timestamptz, version text)`
- `peers(peer_id uuid pk, replica_id uuid, replica_epoch bigint, seq bigint, kind text, updated_at timestamptz)`

Both are small, write-light and indexed by `replica_id`. Nothing in `public` changes.

### Walk-throughs

| Event | What happens |
|---|---|
| **Agent connects** | The load balancer sends it to `coder-1`. The local core registers it, and the directory row reads `agent → coder-1`. |
| **User opens the terminal**, and the request lands on `coder-2` | `coder-2`'s ServerTailnet adds a tunnel to the agent. The directory says `coder-1`, so a `TunnelAdd` goes over the `coder-2↔coder-1` stream. Nodes are exchanged. WireGuard runs over DERP: `coder-2`'s DERP forwards to `coder-1`'s over the cell mesh. The reconnecting PTY opens. |
| **`coder-1` crashes** | Readiness and the EndpointSlice drop it in about 5 s. The agent's websocket breaks, and it reconnects to `coder-0`; the directory row moves. `coder-2` gets `PEER_LOST`, then the new owner, and re-coordinates. The PTY resumes, because its session lives in the agent. |
| **Rolling update** | The new pod comes up and becomes ready, with lease, sync and mesh. The old pod drains its peers onto the others, then stops. No connection is cut without a resume. |
| **Database failover** | Lease renewals fail for up to about 30 s. Replicas keep serving until their own TTL. If the promotion takes longer than the TTL, they all self-fence briefly, which is correct (no split brain), and become ready again as soon as the database answers. Raising the TTL trades failure detection for failover tolerance; the chart exposes it. |

### Kubernetes resources (chart, `platformHA.*`)

- **Per cell:**
  - `Deployment coder-<cell>`, N replicas, with Downward API env (`POD_NAME`, `POD_IP`) and `CODER_PLATFORM_HA_CELL`;
  - `Service coder-<cell>-derp`;
  - `HTTPRoute cell-<cell>.derp.<domain>`.
- **Shared:**
  - the existing `Service coder` for the access URL, over every cell;
  - a headless `Service coder-mesh` for EndpointSlices;
  - a `PDB` per cell;
  - a `NetworkPolicy` allowing the mesh port and DERP between Coder pods only;
  - a `Secret coder-mesh-tls` (a CA plus a leaf per pod, issued at startup from the CA, or by cert-manager when
    present);
  - RBAC to read EndpointSlices.
- **Modes:**
  - `off` (default): today;
  - `activeStandby`: 2 replicas, with the leader the only ready one;
  - `activeActive`: cells.

### Scaling model

- **Per replica:** Coder's guide applies, 2 vCPU / 8 GiB for about 300–350 users, with the relayed (DERP) traffic as
  the dominant cost.
- **Inside a cell:** a mesh of up to 20 links, and coordination streams only between replicas with shared tunnels.
- **Across cells:** no mesh. The directory is the only shared structure, and its write rate follows connects.
- **Where the next limits are:**
  - **Database write and connection budget.** Phase 0 adds a pooler; Coder keeps its own pool.
  - **PostgreSQL pubsub fan-out** at very large scale. Option: Coder's experimental NATS pubsub
    (`coderd/x/nats`, AGPL), with peers from our registry, in a later phase.
  - **The single database primary.** Cross-region active/active is not offered: the database must stay within about
    10 ms of every replica. Regions beyond that are run as a CloudNativePG replica cluster with promotion, for disaster
    recovery.

### The rest of the environment

- **Phase 0 (no code):**
  - CloudNativePG with 3 instances over zones, `minSyncReplicas: 1`, and a `Pooler` (PgBouncer, transaction mode)
    for the platform service and relays;
  - Traefik with 2+ replicas and a PDB;
  - 2 replicas each of the banner and metrics-server;
  - PDBs and topology spread throughout.
- **Phase 4: the platform service.**
  - Its SQLite state moves to PostgreSQL (schema `platform`).
  - The migration runs once at startup, from the SQLite file, and is idempotent; the file is kept as a backup.
  - It runs 2+ replicas. Singletons (reconcilers, the Cloud Drive's PV maker, retention jobs) take a Kubernetes
    `Lease` each.
  - The image registry moves to S3 (MinIO) storage and becomes stateless with 2+ replicas.
  - MinIO runs in distributed mode, 4+ pods with erasure coding, or on an external S3.
- **Workspaces.** A workspace remains one pod with one home volume; that is what a workspace is.
  - To shorten node loss, the platform service applies Kubernetes' **non-graceful node shutdown** taint
    (`node.kubernetes.io/out-of-service`) once a node is confirmed dead. This is fencing at the node level, and it
    detaches the ReadWriteOnce volumes, so the pod reschedules in minutes instead of waiting indefinitely.
  - Storage that can follow, like RWX or replicated volumes, is the route to seconds. It is a storage-class choice,
    documented, not built.

### Phase 5: code-server HA v2 (fixes the three gaps)

1. **Reachable without the workspace pod.** The code-server app becomes a platform route,
   `code-<workspace>.<domain>`. It goes through Traefik with forward-auth against Coder's API, which checks the owner
   or a share, to the active instance's Service in any cluster. The front relay stays, as a fallback path.
2. **Database through the operator.** Relays call the replicator's HTTP API, authenticated by the agent's or the
   instance's token, instead of holding database connections. The cost becomes O(operators), not O(workspaces). The
   operators use the pooler.
3. **The operator scales.**
   - **Watches:** pods and EndpointSlices through informers, with a rate-limited work queue (controller pattern)
     instead of polling.
   - **Heartbeat:** in its own goroutine.
   - **Sharding:** workspaces are hashed into 64 shards, each held as a lease in PostgreSQL. Every operator replica
     works, taking shards as the count changes. No standby sits idle.

   The schema and the relay protocol stay compatible. The new operator reads v1's rows, and v1 relays keep working
   until their workspaces restart.

### Observability, and the cluster network view

- **Metrics:**
  - per replica: state, epoch, lease age;
  - local and remote peers, and tunnels by remote replica;
  - mesh links up or down, and DERP packets forwarded per link;
  - drain duration;
  - directory writes per second;
  - per code-server instance: generation, owning cluster, lease left.
- **Kubernetes Events** on the `coder` Deployment for lease loss, fencing, drain, and cell changes.
- **The cluster network view** (Admin Settings › Network) gains HA layers, from a `platformHA` section of the network
  report:
  - the cells, with their replicas: active, standby or draining, with lease age;
  - mesh links and their state;
  - each workspace's agent → owning replica;
  - the replicator's shard owners;
  - each HA workspace's front relay → its active instance, marked when another cluster has taken it over.

## Options considered

### A: License Coder Enterprise HA

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | A per-user license |
| Scalability | Proven, but pgcoord loads the database with every node update |
| Fit | Rejected by direction: we build our own, better design |

### B: Active/standby Coder (leader-gated readiness)

| Dimension | Assessment |
|---|---|
| Complexity | Low: a lease and a readiness check; no coordinator or DERP changes |
| Availability | Failover in about TTL + readiness, so 10–15 s (measured: 12.3–12.8 s; a rolling update about 2 s) |
| Scalability | None beyond one replica |
| Fit | **Adopted as Phase 2**: HA soon at low risk, and kept as a mode for small installs |

### C: A PostgreSQL-backed coordinator (our own pgcoord)

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Scalability | Database writes and NOTIFYs per node update: the scaling limit we want to avoid |
| Fit | Rejected |

### D: Sticky routing at the gateway only

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Correctness | Fails: agents and clients carry different keys (an agent token, an agent ID in the path), and DERP still needs a mesh |
| Fit | Rejected |

### E: Mesh Coordinator + DERP cells + registry with fencing (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | High, but contained in one Community package with Coder's conformance tests |
| Scalability | Linear in cells; database cost O(connects); streams only where tunnels are |
| Availability | Active/active, with drain-aware zero-drop rolling updates |
| Fit | **Adopted** (Phase 3), after B |

## Trade-off analysis

- **E against A.** E costs engineering, testing and ownership of a distributed component. It returns:
  - no license;
  - lower database load (no write per node update);
  - a bounded mesh (cells);
  - zero-drop rolling updates (drain), which Coder's HA does not do;
  - one model across the stack: the same leases and fencing as our replicator.
- **B before E.** B gives most of the availability benefit, about 10–15 s RTO, within one phase and at very low risk.
  E then adds horizontal scale and removes even that failover gap. Doing E alone would leave the platform without HA
  for longer.
- **Directory in PostgreSQL against gossip.** PostgreSQL already holds every critical state here, with CloudNativePG
  HA and synchronous replication. A gossip layer would add a second consistency model and its partition failure
  modes. The directory's write rate, connects only, keeps PostgreSQL comfortably inside its budget.
- **TTL tuning.** A short TTL means fast failure detection, but brief self-fencing during database failovers. A long
  TTL is the other way round. Defaults: 10 s, renewed every 3 s, configurable.

## Consequences

- **Easier:**
  - running 3+ Coder replicas across zones;
  - upgrades without dropped sessions;
  - growing capacity by adding cells;
  - seeing HA state in the network view.
- **Harder:**
  - the fork owns a distributed component, so upstream rebases must keep the `tailnet.Coordinator` and DERP
    interfaces in view. Conformance and chaos tests in CI guard this;
  - one more schema, `platform_ha`, to back up. It is in the same database, so it is covered by CloudNativePG backups.
- **To revisit:**
  - NATS pubsub at very large scale;
  - storage that follows workspaces;
  - cross-region disaster recovery.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Split brain: two replicas serve one peer | Epoch and `seq` compare-and-set; a replica without its lease self-fences; readers ignore rows of lapsed replicas |
| Upstream changes the coordinator or DERP APIs | One adapter package, Coder's own conformance suite (`tailnet/test`), and a multi-replica integration test in CI |
| A database failover longer than the TTL causes brief self-fencing | Make the TTL configurable; alert on it; synchronous replica for fast promotion |
| The drain takes longer than the grace period | Jittered drain sized to the peer count; grace period configurable; whatever is left resumes on reconnect |
| The licensed path conflicts with ours | Ours is only constructed through the Community factory, which Enterprise does not call when licensed; the registry and mesh check the entitlement and stand aside |
| Regressions in existing features | Every phase is behind values, off by default; the static checks, 155 unit tests, live checks and the release CVE gate run on every phase |

## Compliance

- Nothing under `enterprise/` changes; no code is copied from it; no license-key behaviour is moved, changed or
  disabled. Ours is new Community code (AGPL), in the fork, using Coder's public Community interfaces and the
  BSD-licensed tailscale library.
- When a `high_availability` license is active, Coder's Enterprise HA runs and ours stands aside.
- **Use (the owner's statement, 2026-10-20):** this platform supports one internal team only. It is a one-off for a
  niche team. It will never be used as the basis of a project for gain, never function toward profit, and never divert
  business from Coder. It is not offered, sold or hosted for anyone else.
- **Sign-off needed:** the owner confirms this reading of `LICENSE.enterprise` before Phase 3 ships.

## Rollout and verification

| Phase | Delivers | Exit criteria |
|---|---|---|
| **0: Infra** | CloudNativePG with 3 instances, synchronous replica, Pooler; Traefik 2+; PDBs and spread; banner and metrics-server ×2 | Chart checks; kill the database primary and lose no committed write; kill a Traefik pod and lose no request |
| **1: Registry** | `platform_ha` schema, registry, leases, self-fencing, EndpointSlice watch, metrics (off by default) | Unit tests; the lease survives a database failover |
| **2: Active/standby** | `mode: activeStandby`: leader-gated readiness, warm standby | Kill the leader and have connections back in < 15 s; rolling update; 0 regressions in live checks |
| **3: Active/active** | Mesh Coordinator, DERP cell mesh, drain, `mode: activeActive` | Coder's coordinator conformance suite, single and multi-replica; chaos tests (kill a replica mid-terminal, drain, partition a replica, database failover); a scale test with the Community `scaletest` tool |
| **4: Platform service and storage** | Its state in PostgreSQL with leases; registry on S3; distributed MinIO | Every platform view works across a replica kill; migration from SQLite is idempotent |
| **5: code-server HA v2** | Platform route with forward-auth, relays through the operator API, sharded watch-based operator | 1,000 simulated workspaces with no false takeovers; the IDE survives workspace pod loss |
| **6: Network view** | The HA layers above | Live checks of each layer |

## Action items

1. [x] Owner: approve this ADR and confirm the Compliance reading (approved 2026-10-20).
2. [x] Phase 0: values and templates for CloudNativePG (3 instances, sync, Pooler), Traefik, PDBs and spread, and the
   `values-ha.example.yaml` update.
3. [x] Phase 1: the replica registry (`coderd/platformha`): the `platform_ha` schema bootstrap, leases under epochs,
   self-fencing by a deadline timer (measured from each renewal's start, every database call cut off by it; tested:
   a replica fences with a full renew interval of its lease left - 297-301 ms of 300 over 25 runs), rejoin under a
   new epoch, metrics; `global.platformHA.mode: registry`. The EndpointSlice membership watch moves to Phase 3,
   where the mesh needs fast failure detection (the fork has no Kubernetes client yet).
4. [x] Phase 2: `global.platformHA.mode: activeStandby` (Coder 2.0.0-platform.101). Built as a **warm** standby, not
   leader-gated readiness: a standby does not start Coder at all until its turn. Two running Coder replicas would
   both run background work, and the unlicensed Enterprise binary reports more than one replica as an entitlement
   **error** ("You will be unable to connect to workspaces"), which we may not hide. The pieces:
   - the active lease `coder-active` in `platform_ha.leases` (compare-and-set, fenced like the registry lease);
   - the pod labeled `coder-airgapped/ha-role=active|standby`, the Service selecting `active`, and a higher
     `pod-deletion-cost` on the active pod so rollouts remove standbys first;
   - a health server on port 2113 (`/livez`, `/readyz`, `/status`, and `/handover` for the preStop hook);
   - a handover in which the successor starts Coder and takes traffic before the leader lets go, with the let-go
     lease reserved for it;
   - a standby watching the lease every 250 ms, so neither a handover nor a takeover waits for a renewal round.

   Measured live (one node; Coder starts in about 50 ms once its turn comes):
   - a crash (the container killed, no preStop): back through Traefik after **12.3–12.8 s** (the 10 s lease);
   - a rolling restart: **about 2 s** without Coder. The old pod leaves the endpoints the moment it is deleted,
     and Traefik follows the new endpoint within about 1.5 s.

   The rolling-update gap would close with a proactive handover to a newer-revision standby before the leader's
   pod is deleted; that is left for later, and active/active (Phase 3) has none. A crashed leader's container,
   restarted in place, could win the lapsed lease back as a fresh standby: since platform.102 the longest-running
   ready standby takes it first (anyone after one more lease), so a crash-looping pod cannot keep retaking it
   (measured: the senior standby took over, back after 13.9 s).
5. [ ] Phase 3. **Amended 2026-10-20 (the owner's choice): the platform runs Coder's open-source (AGPL) build**
   (`CODER_BUILD_AGPL=1`, platform.103), so several Coder replicas run with no licence gate. The unlicensed Enterprise
   binary would show admins a permanent error ("multiple replicas but high availability is an Enterprise feature. You
   will be unable to connect to workspaces"), which we may not hide. The build loses little:
   - the Share dialog's workspace-sharing settings call and the per-template notification method (both Enterprise
     routes; the dashboard falls back to the organization's setting and shows the method read-only);
   - audit and connection-log rows (nothing reads them);
   - 90-day dormancy;
   - adding a licence ever.

   With no Enterprise code in the image, "Precedence" below simplifies: coderd's `Options.TailnetCoordinator` takes
   the Mesh Coordinator directly in `activeActive`, with no factory needed. The mesh is built by **wrapping** the
   Community coordinator through its public API. Coder's tailnet code is not modified.
   - The replica that owns a tunnel's **destination** runs it. For a remote source it keeps a *proxy* session: an
     ordinary `Coordinate` call under the source's id, trusted, fed by the source's replica.
   - The source's replica forwards the source's requests for remote destinations to the owner (`UpdateSelf`,
     `AddTunnel`, `RemoveTunnel`, `ReadyForHandshake`, `Disconnect`). It merges the proxy's responses into the
     source's stream.
   - Moves, deaths and lost streams turn into `LOST` peer updates, which Coder's clients already retry on.
   - Replica streams are WebSockets on the health port, which no Service exposes. They are authenticated by an HMAC
     of the mesh key (in `platform_ha`, created once). The key itself never travels; node data is public keys and
     endpoints, and the data plane is WireGuard. The DERP servers take the same mesh key.
   - `Node(id)` (only the agent's DERP latency in the API) answers for local peers only.
   - `meshcoord`, the `NewCoordinator` factory, `derpcell`, and the `DERPMap()` composition;
   - drain;
   - the conformance, chaos and scale tests.
6. [ ] Phases 4–6 as above, each with its own exit criteria.
