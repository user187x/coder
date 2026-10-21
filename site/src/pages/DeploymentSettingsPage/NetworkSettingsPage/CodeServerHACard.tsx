import { cn } from "cn";
import { useState } from "react";
import { useQuery } from "react-query";
import {
	type CodeServerHA,
	type CodeServerInstance,
	clusterHA,
	type StorageReport,
} from "#/api/clusterNetwork";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableEmpty } from "#/components/TableEmpty/TableEmpty";
import {
	ago,
	bytes,
	LiveStatus,
	StatusDot,
	Tile,
	useNow,
} from "#/modules/platform/ClusterVisuals";
import { seconds } from "./clusterFormat";
import { KindSwatch } from "./componentKinds";
import { useOpenEntity } from "./EntityDetails";

/**
 * Settings > Network, the code-server HA and storage card: the pieces that
 * keep a workspace's code-server up and its files kept, as they are now -
 * the code-server-replicator (its replicas, which one holds this cluster's
 * operator lock), each workspace's active instance with its lease, the
 * instances being replaced and the relay in the workspace's pod, the recent
 * hand-offs; then the storage classes with the volumes on each, and the
 * Cloud Drive (its backend, its CSI driver and every account's volume).
 * Read from the platform service (csha.py's tables in Coder's database and
 * the Kubernetes API) every 10 seconds.
 */
export const CodeServerHACard: React.FC<{ paused: boolean }> = ({ paused }) => {
	const query = useQuery(clusterHA(paused));
	const d = query.data;
	return (
		<section
			aria-labelledby="cluster-ha"
			className="flex flex-col gap-5 rounded-lg border border-solid border-border p-6"
			data-testid="cluster-ha-card"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="cluster-ha" className="m-0 text-base font-semibold">
					code-server HA and storage
				</h2>
				<LiveStatus paused={paused} updatedAt={query.dataUpdatedAt} />
			</div>
			{query.isLoading ? (
				<Loader />
			) : query.error ? (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					It could not be read:{" "}
					{query.error instanceof Error ? query.error.message : "unknown error"}
				</p>
			) : d ? (
				<>
					<HAPart ha={d.codeServerHA} />
					{d.storage ? (
						<StoragePart storage={d.storage} />
					) : (
						<p role="alert" className="m-0 text-sm text-content-destructive">
							The storage could not be read: {d.storageError ?? "unknown error"}
						</p>
					)}
				</>
			) : null}
		</section>
	);
};

const Sub: React.FC<{ id: string; children: React.ReactNode }> = ({
	id,
	children,
}) => (
	<h3 id={id} className="m-0 text-sm font-semibold">
		{children}
	</h3>
);

const PodLink: React.FC<{
	namespace: string;
	name: string;
	children?: React.ReactNode;
}> = ({ namespace, name, children }) => {
	const open = useOpenEntity();
	return (
		<button
			type="button"
			onClick={() => open({ type: "pod", namespace, name })}
			className={cn(
				"cursor-pointer border-0 bg-transparent p-0 text-left text-xs text-content-link hover:underline",
				children === undefined && "font-mono",
			)}
		>
			{children ?? name}
		</button>
	);
};

const NodeLink: React.FC<{ name: string | null }> = ({ name }) => {
	const open = useOpenEntity();
	return name ? (
		<button
			type="button"
			onClick={() => open({ type: "node", name })}
			className="cursor-pointer border-0 bg-transparent p-0 font-mono text-xs text-content-link hover:underline"
		>
			{name}
		</button>
	) : (
		<span className="text-content-secondary">N/A</span>
	);
};

// ------------------------------------------------------------------ code-server HA

const LOCK_TEXT = {
	holds: "holds the lock",
	waits: "waits (standby)",
	"not connected": "not connected to the database",
	unknown: "unknown",
} as const;

const HAPart: React.FC<{ ha: CodeServerHA }> = ({ ha }) => {
	const now = useNow();
	if (!ha.installed) {
		return (
			<div className="flex flex-col gap-2">
				<Sub id="ha-code-server">code-server HA</Sub>
				<p className="m-0 text-sm text-content-secondary">
					Not installed in this cluster: no code-server-replicator runs here and
					Coder's database has no code_server_ha schema (the chart's
					codeServerHA).
					{ha.error ? ` ${ha.error}` : ""}
				</p>
			</div>
		);
	}
	const ready = ha.replicators.filter((r) => r.ready).length;
	const running = ha.instances.filter((i) => i.state === "running").length;
	const here = ha.clusters.find((c) => c.name === ha.cluster);
	const holder = ha.replicators.find((r) => r.lock === "holds");

	return (
		<div className="flex flex-col gap-4">
			<Sub id="ha-code-server">code-server HA</Sub>
			{ha.error && (
				<p role="alert" className="m-0 text-sm text-content-warning">
					{ha.error}
				</p>
			)}
			<div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
				<Tile
					label="Replicator"
					value={`${ready} / ${ha.replicas ?? ha.replicators.length} ready`}
					sub={
						holder
							? `lock: ${holder.name.split("-").slice(-1)[0]} since ${ago(ha.lockSince, now)}`
							: ha.schema
								? "nobody holds the lock"
								: "no schema yet"
					}
				/>
				<Tile
					label="This cluster"
					value={ha.cluster ?? "N/A"}
					sub={
						here
							? `heartbeat ${seconds(here.heartbeatAgo)} ago${here.healthy ? "" : " · NOT answering"}`
							: "no heartbeat recorded"
					}
				/>
				<Tile
					label="Instances"
					value={`${running} / ${ha.instances.length} running`}
					sub={
						ha.instances.length
							? `${ha.instances.reduce((n, i) => n + i.superseded.length, 0)} being replaced`
							: "no workspace uses it now"
					}
				/>
				<Tile
					label="Lease"
					value={ha.leaseSeconds ? `${ha.leaseSeconds} s` : "N/A"}
					sub="renewed every round (5 s)"
				/>
			</div>
			<p className="m-0 text-xs leading-relaxed text-content-secondary">
				One code-server instance per workspace is active, holding a lease in
				Coder's database that the replicator renews. If the instance fails, the
				replicator starts the next generation; the relay in the workspace's pod
				sends new connections to it (the editor shows "code-server is starting"
				and reloads while it starts), and code-server's settings, keybindings
				and extension list come back from the database. An instance being
				replaced passes connections on to the new one until it is fenced. If the
				replicator holding the lock stops, its standby takes the lock (it tries
				every 5 s); the instances keep running meanwhile.
			</p>
			<div className="flex flex-col gap-2" data-testid="ha-replicators">
				<span className="text-xs font-medium text-content-secondary">
					Replicators
				</span>
				<div className="overflow-x-auto">
					<Table aria-label="code-server replicators">
						<TableHeader>
							<TableRow>
								{[
									"Pod",
									"Node",
									"State",
									"Operator lock",
									"Restarts",
									"Up",
								].map((h) => (
									<TableHead key={h}>{h}</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{ha.replicators.length ? (
								ha.replicators.map((r) => (
									<TableRow
										key={r.name}
										data-testid={`ha-replicator-${r.name}`}
									>
										<TableCell>
											<span className="inline-flex items-center gap-1.5">
												<KindSwatch kind="replicator" />
												<PodLink namespace={r.namespace} name={r.name} />
											</span>
										</TableCell>
										<TableCell>
											<NodeLink name={r.node} />
										</TableCell>
										<TableCell>
											<StatusDot status={r.ready ? "ok" : "error"}>
												{r.deleting
													? "terminating"
													: r.ready
														? "ready"
														: "not ready"}
											</StatusDot>
										</TableCell>
										<TableCell>
											<StatusDot
												status={
													r.lock === "holds" || r.lock === "waits"
														? "ok"
														: "warn"
												}
											>
												{LOCK_TEXT[r.lock]}
												{r.lock === "holds" && ha.lockSince
													? ` (${ago(ha.lockSince, now)})`
													: ""}
											</StatusDot>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{r.restarts}
										</TableCell>
										<TableCell
											className="text-right tabular-nums"
											data-pixel="ignore"
										>
											{ago(r.started, now)}
										</TableCell>
									</TableRow>
								))
							) : (
								<TableEmpty message="No replicator runs in this cluster." />
							)}
						</TableBody>
					</Table>
				</div>
			</div>
			{ha.clusters.length > 1 && (
				<div className="flex flex-col gap-2">
					<span className="text-xs font-medium text-content-secondary">
						Clusters sharing the database
					</span>
					<div className="overflow-x-auto">
						<Table aria-label="Clusters">
							<TableHeader>
								<TableRow>
									{[
										"Cluster",
										"Heartbeat",
										"Answering since",
										"Takes others' workspaces",
									].map((h) => (
										<TableHead key={h}>{h}</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{ha.clusters.map((c) => (
									<TableRow key={c.name}>
										<TableCell>{c.name}</TableCell>
										<TableCell>
											<StatusDot status={c.healthy ? "ok" : "error"}>
												{seconds(c.heartbeatAgo)} ago
											</StatusDot>
										</TableCell>
										<TableCell>
											{c.since ? `${ago(c.since, now)} ago` : "N/A"}
										</TableCell>
										<TableCell>{c.external ? "yes" : "no"}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</div>
			)}
			<Instances ha={ha} />
			<Events ha={ha} />
		</div>
	);
};

const instanceStatus = (
	i: CodeServerInstance,
): ["ok" | "warn" | "error", string] =>
	i.state === "running" && i.activePod?.ready
		? ["ok", "running"]
		: i.state === "starting"
			? ["warn", "starting"]
			: i.activePod
				? ["warn", i.state]
				: i.activeCluster && i.activeCluster !== i.homeCluster
					? ["warn", `in ${i.activeCluster}`]
					: ["error", i.state];

const Instances: React.FC<{ ha: CodeServerHA }> = ({ ha }) => {
	const now = useNow();
	return (
		<div className="flex flex-col gap-2" data-testid="ha-instances">
			<span className="text-xs font-medium text-content-secondary">
				Instances by workspace
			</span>
			<div className="overflow-x-auto">
				<Table aria-label="code-server instances">
					<TableHeader>
						<TableRow>
							{[
								"Workspace",
								"State",
								"Active instance",
								"Node",
								"Lease",
								"Relay (workspace pod)",
								"Being replaced",
								"Kept state",
							].map((h) => (
								<TableHead key={h}>{h}</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{ha.instances.length ? (
							ha.instances.map((i) => {
								const [status, label] = instanceStatus(i);
								const ws = i.workspacePod;
								return (
									<TableRow
										key={i.workspaceId}
										data-testid={`ha-instance-${i.workspaceId}`}
									>
										<TableCell>
											<div className="flex flex-col">
												<span>
													{i.owner ?? "?"}/
													{ws?.workspace ?? i.workspaceId.slice(0, 8)}
												</span>
												<span className="text-[11px] text-content-secondary">
													home {i.homeCluster}
													{i.homeNode ? ` · ${i.homeNode}` : ""}
												</span>
											</div>
										</TableCell>
										<TableCell>
											<StatusDot status={status}>{label}</StatusDot>
											{i.message && (
												<div className="text-[11px] text-content-secondary">
													{i.message}
												</div>
											)}
										</TableCell>
										<TableCell>
											{i.activePod ? (
												<span className="inline-flex items-center gap-1.5">
													<KindSwatch kind="code-server" />
													<PodLink
														namespace={i.activePod.namespace}
														name={i.activePod.name}
													>
														gen {i.activePod.generation}
														{i.activePod.ready ? "" : " (not ready)"}
													</PodLink>
												</span>
											) : (
												<span className="text-xs text-content-secondary">
													{i.activeCluster && i.activeCluster !== ha.cluster
														? `in cluster ${i.activeCluster} (gen ${i.generation})`
														: `none here (gen ${i.generation})`}
												</span>
											)}
										</TableCell>
										<TableCell>
											<NodeLink name={i.activePod?.node ?? null} />
										</TableCell>
										<TableCell className="whitespace-nowrap text-xs tabular-nums">
											{i.leaseLeft == null ? (
												"none"
											) : i.leaseLeft >= 0 ? (
												`${seconds(i.leaseLeft)} left`
											) : (
												<span className="text-content-warning">
													lapsed {seconds(i.leaseLeft)} ago
												</span>
											)}
										</TableCell>
										<TableCell>
											{ws ? (
												ws.relay ? (
													<StatusDot status={ws.relayReady ? "ok" : "error"}>
														<PodLink namespace={ws.namespace} name={ws.name}>
															{ws.relayReady ? "ready" : "not ready"}
														</PodLink>
														{ws.relayRestarts ? (
															<span className="text-content-secondary">
																{" "}
																· {ws.relayRestarts} restarts
															</span>
														) : null}
													</StatusDot>
												) : (
													<span className="text-xs text-content-secondary">
														no relay container
													</span>
												)
											) : (
												<span className="text-xs text-content-secondary">
													no workspace pod here
												</span>
											)}
										</TableCell>
										<TableCell>
											{i.superseded.length ? (
												<div className="flex flex-col gap-0.5">
													{i.superseded.map((p) => (
														<PodLink
															key={p.name}
															namespace={p.namespace}
															name={p.name}
														>
															gen {p.generation}: relays on until fenced
														</PodLink>
													))}
												</div>
											) : (
												<span className="text-xs text-content-secondary">
													none
												</span>
											)}
										</TableCell>
										<TableCell className="whitespace-nowrap text-xs">
											{i.stateFiles} files
											{i.stateUpdatedAt ? (
												<span className="text-content-secondary">
													{" "}
													· {ago(i.stateUpdatedAt, now)} ago
												</span>
											) : null}
										</TableCell>
									</TableRow>
								);
							})
						) : (
							<TableEmpty
								message={
									ha.schema
										? "No workspace runs code-server HA now (a template turns it on)."
										: "The replicator has not created its schema yet."
								}
							/>
						)}
					</TableBody>
				</Table>
			</div>
			{ha.unregistered.length > 0 && (
				<p className="m-0 text-xs text-content-secondary">
					Instances of workspaces no longer registered (being removed):{" "}
					{ha.unregistered.map((p) => p.name).join(", ")}
				</p>
			)}
		</div>
	);
};

const EVENT_STATUS: Record<string, "ok" | "warn" | "error"> = {
	failed: "error",
	fenced: "warn",
	failback: "warn",
	removed: "warn",
};

const Events: React.FC<{ ha: CodeServerHA }> = ({ ha }) => {
	const now = useNow();
	const owners = Object.fromEntries(
		ha.instances.map((i) => [
			i.workspaceId,
			`${i.owner ?? "?"}/${i.workspacePod?.workspace ?? i.workspaceId.slice(0, 8)}`,
		]),
	);
	return (
		<div className="flex flex-col gap-2" data-testid="ha-events">
			<span className="text-xs font-medium text-content-secondary">
				Recent hand-offs and starts
			</span>
			{ha.events.length ? (
				<ul className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0 text-xs">
					{ha.events.map((e, i) => (
						<li key={i} className="flex flex-wrap items-baseline gap-x-2">
							<span
								className="w-16 shrink-0 tabular-nums text-content-secondary"
								data-pixel="ignore"
							>
								{ago(e.at, now)} ago
							</span>
							<StatusDot status={EVENT_STATUS[e.event] ?? "ok"}>
								<b className="font-semibold">{e.event}</b>
							</StatusDot>
							<span className="text-content-secondary">
								{e.workspaceId
									? (owners[e.workspaceId] ?? e.workspaceId.slice(0, 8))
									: ""}
								{e.cluster ? ` · ${e.cluster}` : ""}
							</span>
							<span className="[overflow-wrap:anywhere]">{e.detail}</span>
						</li>
					))}
				</ul>
			) : (
				<p className="m-0 text-xs text-content-secondary">None recorded.</p>
			)}
		</div>
	);
};

// ------------------------------------------------------------------ storage

const StoragePart: React.FC<{ storage: StorageReport }> = ({ storage: s }) => {
	const now = useNow();
	const cd = s.cloudDrive;
	return (
		<div className="flex flex-col gap-4">
			<Sub id="storage-classes">Storage classes</Sub>
			<div className="overflow-x-auto" data-testid="storage-classes">
				<Table aria-label="Storage classes">
					<TableHeader>
						<TableRow>
							{[
								"Class",
								"Provisioner",
								"Reclaim",
								"Binding",
								"Expansion",
								"Volumes",
								"Bound capacity",
							].map((h) => (
								<TableHead key={h}>{h}</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{s.classes.map((c) => (
							<TableRow key={c.name} data-testid={`storage-class-${c.name}`}>
								<TableCell>
									<span className="inline-flex items-center gap-2">
										{c.name}
										{c.default && (
											<Badge size="xs" variant="green">
												default
											</Badge>
										)}
									</span>
								</TableCell>
								<TableCell className="font-mono text-xs">
									{c.provisioner}
								</TableCell>
								<TableCell>{c.reclaimPolicy}</TableCell>
								<TableCell className="text-xs">{c.bindingMode}</TableCell>
								<TableCell>{c.expansion ? "yes" : "no"}</TableCell>
								<TableCell className="text-xs">
									{c.claims.length ? (
										<details>
											<summary className="cursor-pointer">
												{c.bound} bound
												{c.volumes > c.bound ? ` of ${c.volumes}` : ""}
											</summary>
											<ul className="m-0 mt-1 list-none p-0 font-mono text-[11px]">
												{c.claims.map((claim) => (
													<li key={claim}>{claim}</li>
												))}
											</ul>
										</details>
									) : (
										`${c.bound} bound${c.volumes > c.bound ? ` of ${c.volumes}` : ""}`
									)}
									{c.pending.length > 0 && (
										<div className="text-content-warning">
											{c.pending.length} waiting: {c.pending.join(", ")}
										</div>
									)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{bytes(c.capacityBytes)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<p className="m-0 text-xs text-content-secondary">
				{s.volumesReadable
					? `${s.static.volumes} volumes of no class (made by hand${s.static.drivers.length ? `, ${s.static.drivers.join(", ")}` : ""}), ${s.static.bound} bound.`
					: "The volumes are not readable by the platform service (persistentvolumes list)."}
				{s.csiDrivers
					? ` CSI drivers: ${s.csiDrivers.map((d) => d.name).join(", ") || "none"}.`
					: ""}
			</p>
			{cd && <CloudDrivePart cd={cd} now={now} />}
		</div>
	);
};

const CloudDrivePart: React.FC<{
	cd: NonNullable<StorageReport["cloudDrive"]>;
	now: number;
}> = ({ cd, now }) => {
	const [all, setAll] = useState(false);
	const items = all
		? cd.volumes.items
		: cd.volumes.items.filter((v) => v.phase === "Bound" || v.usedBy.length);
	const b = cd.backend;
	return (
		<div className="flex flex-col gap-3" data-testid="cloud-drive">
			<Sub id="cloud-drive">User storage (Cloud Drive)</Sub>
			{!cd.enabled ? (
				<p className="m-0 text-sm text-content-secondary">
					Off in this installation (global.userStorage).
				</p>
			) : (
				<>
					<div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
						<Tile
							label="Backend"
							value={
								b.error
									? "unreadable"
									: b.kind === "minio"
										? "MinIO (the chart's)"
										: `S3 (${b.source})`
							}
							sub={b.error ?? `${b.endpoint ?? ""} · bucket ${b.bucket ?? "?"}`}
						/>
						<Tile
							label="Connected"
							value={
								cd.status.connected == null
									? "not checked yet"
									: cd.status.connected
										? "yes"
										: "no"
							}
							sub={
								cd.status.error ??
								(cd.status.checkedAt
									? `S3 check ${cd.status.latencyMs ?? "?"} ms, ${ago(new Date(cd.status.checkedAt * 1000).toISOString(), now)} ago`
									: "")
							}
						/>
						<Tile
							label="Account volumes"
							value={`${cd.volumes.byPhase.Bound ?? 0} bound`}
							sub={`${cd.volumes.inUse} mounted now · ${cd.volumes.total} in all`}
						/>
						<Tile
							label="CSI driver"
							value={cd.csiDriver}
							sub={
								cd.driverInstalled === false
									? "NOT installed"
									: `${cd.plugin.filter((p) => p.ready).length} / ${cd.plugin.length} node plugins ready${cd.quotaGiB ? ` · ${cd.quotaGiB} GiB each` : ""}`
							}
						/>
					</div>
					<div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
						<span className="inline-flex flex-wrap items-center gap-1.5">
							<KindSwatch kind="storage" /> MinIO:
							{cd.minio.length
								? cd.minio.map((p) => (
										<PodLink key={p.name} namespace={p.namespace} name={p.name}>
											{p.name}
											{p.ready ? "" : " (not ready)"}
										</PodLink>
									))
								: " none (an S3 service of yours)"}
						</span>
						<span className="inline-flex flex-wrap items-center gap-1.5">
							<KindSwatch kind="storage" /> Node plugin:
							{cd.plugin.map((p) => (
								<PodLink key={p.name} namespace={p.namespace} name={p.name}>
									{p.node ?? p.name}
									{p.ready ? "" : " (not ready)"}
								</PodLink>
							))}
						</span>
						<span className="text-content-secondary">
							By state:{" "}
							{Object.entries(cd.volumes.byPhase)
								.map(([k, v]) => `${v} ${k.toLowerCase()}`)
								.join(", ") || "none"}
							{cd.volumes.byPhase.Released
								? " (released: kept from an earlier install, Retain)"
								: ""}
						</span>
					</div>
					<div className="overflow-x-auto">
						<Table aria-label="Account volumes">
							<TableHeader>
								<TableRow>
									{["Account", "Volume", "State", "Size", "Mounted by"].map(
										(h) => (
											<TableHead key={h}>{h}</TableHead>
										),
									)}
								</TableRow>
							</TableHeader>
							<TableBody>
								{items.length ? (
									items.map((v) => (
										<TableRow key={v.name}>
											<TableCell>{v.user ?? "N/A"}</TableCell>
											<TableCell className="font-mono text-xs">
												{v.name}
											</TableCell>
											<TableCell>
												<StatusDot
													status={
														v.phase === "Bound"
															? "ok"
															: v.phase === "Released" ||
																	v.phase === "Available"
																? "warn"
																: "error"
													}
												>
													{v.phase ?? "Unknown"}
												</StatusDot>
											</TableCell>
											<TableCell className="tabular-nums">
												{v.capacity ?? "N/A"}
											</TableCell>
											<TableCell className="text-xs">
												{v.usedBy.length ? (
													v.usedBy.map((pod) => (
														<div key={pod}>
															<PodLink
																namespace={(v.claim ?? "").split("/")[0]}
																name={pod}
															/>
														</div>
													))
												) : (
													<span className="text-content-secondary">none</span>
												)}
											</TableCell>
										</TableRow>
									))
								) : (
									<TableEmpty message="No account volume bound." />
								)}
							</TableBody>
						</Table>
					</div>
					{cd.volumes.items.length > items.length || all ? (
						<Button
							size="sm"
							variant="outline"
							className="self-start"
							onClick={() => setAll(!all)}
						>
							{all
								? "Show the bound ones only"
								: `Show all ${cd.volumes.items.length} (released ones too)`}
						</Button>
					) : null}
					{cd.libraries.length > 0 && (
						<p className={cn("m-0 text-xs text-content-secondary")}>
							Shared libraries:{" "}
							{cd.libraries
								.map((l) => `${l.name} (${l.phase ?? "?"})`)
								.join(", ")}
						</p>
					)}
				</>
			)}
		</div>
	);
};
