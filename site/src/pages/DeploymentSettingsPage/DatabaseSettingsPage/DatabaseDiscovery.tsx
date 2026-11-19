import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import type {
	DatabaseConfiguration,
	DatabaseInstance,
	PersistenceReport,
} from "#/api/platform";
import { Badge } from "#/components/Badge/Badge";
import { SearchField } from "#/components/SearchField/SearchField";
import { ago, useNow } from "#/modules/platform/ClusterVisuals";
import {
	replicaHealthy,
	replicationLabel,
} from "../PersistenceSettingsPage/PersistenceMap";

export function DatabaseConfigurationCard({
	configuration,
}: {
	configuration?: DatabaseConfiguration;
}) {
	const [filter, setFilter] = useState("");
	const search = filter.trim().toLowerCase();
	const resources =
		configuration?.resources.filter((resource) =>
			[
				resource.kind,
				resource.name,
				resource.namespace,
				resource.managedBy,
				...Object.entries(resource.values).flat(),
			].some((value) =>
				String(value ?? "")
					.toLowerCase()
					.includes(search),
			),
		) ?? [];
	return (
		<section
			className="dashboard-panel flex flex-col gap-4"
			aria-labelledby="database-configuration-title"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2
						id="database-configuration-title"
						className="m-0 text-base font-semibold"
					>
						Configuration sources
					</h2>
					<p className="mt-1 mb-0 text-sm text-content-secondary">
						Live Kubernetes values and the resources that supply them.
						Credentials and raw manifests are excluded.
					</p>
				</div>
				{configuration && (
					<SearchField
						value={filter}
						onChange={setFilter}
						aria-label="Filter database configuration"
						placeholder="Filter resources or values"
					/>
				)}
			</div>
			{!configuration && (
				<p className="m-0 text-sm text-content-secondary">
					The configuration inventory is unavailable.
				</p>
			)}
			{configuration && resources.length === 0 && (
				<p className="m-0 text-sm text-content-secondary">
					{search
						? "No matching resources."
						: "No configuration resources were reported."}
				</p>
			)}
			{resources.map(({ kind, name, namespace, managedBy, values }) => (
				<details
					key={`${kind}/${namespace ?? ""}/${name}`}
					className="min-w-0 rounded-lg border border-solid border-border bg-surface-primary p-3"
				>
					<summary className="cursor-pointer wrap-anywhere">
						<strong className="text-sm">
							{kind} · {name}
						</strong>
						<span className="ml-2 text-xs text-content-secondary">
							{namespace ?? "Cluster-scoped"}
							{managedBy && ` · ${managedBy}`}
						</span>
					</summary>
					<dl className="mb-0 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
						{Object.entries(values)
							.filter(
								([field, value]) =>
									!search ||
									[kind, name, namespace, managedBy, field, value].some(
										(item) =>
											String(item ?? "")
												.toLowerCase()
												.includes(search),
									),
							)
							.map(([field, value]) => (
								<div key={field} className="contents">
									<dt className="wrap-anywhere font-mono text-xs text-content-secondary">
										{field}
									</dt>
									<dd className="m-0 wrap-anywhere">{String(value)}</dd>
								</div>
							))}
					</dl>
				</details>
			))}
			{Boolean(configuration?.unavailable.length) && (
				<details className="rounded-lg border border-solid border-border bg-surface-primary p-3 text-sm">
					<summary className="cursor-pointer">
						Resources unavailable to discovery
					</summary>
					<ul className="mb-0">
						{configuration?.unavailable.map(({ resource, status }) => (
							<li key={resource}>
								{resource}
								{status ? ` · HTTP ${status}` : ""}
							</li>
						))}
					</ul>
				</details>
			)}
		</section>
	);
}

function TopologyNode({
	designation,
	name,
	children,
}: {
	designation: string;
	name: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="min-w-0 rounded-lg border border-solid border-border bg-surface-primary">
			<div className="border-0 border-b border-solid border-border p-3">
				<div className="text-xs text-content-secondary">{designation}</div>
				<h3 className="m-0 wrap-anywhere text-sm font-semibold">{name}</h3>
			</div>
			<div className="flex flex-col items-start gap-2 p-3 text-xs text-content-secondary">
				{children}
			</div>
		</div>
	);
}

function TopologyConnection({
	label,
	dashed = false,
}: {
	label: string;
	dashed?: boolean;
}) {
	return (
		<div className="flex flex-col items-center text-xs text-content-secondary">
			<div
				aria-hidden
				className={
					dashed
						? "h-3 border-0 border-l border-dashed border-content-secondary"
						: "h-3 border-0 border-l border-solid border-content-secondary"
				}
			/>
			<span>{label}</span>
			<ChevronDownIcon aria-hidden className="size-4" />
		</div>
	);
}

function DatabaseInstanceNode({ instance }: { instance: DatabaseInstance }) {
	const primary = instance.role === "primary";
	const healthy = primary ? instance.ready : replicaHealthy(instance);
	return (
		<TopologyNode
			designation={primary ? "Primary · writes" : "Replica"}
			name={instance.name}
		>
			<Badge size="xs" variant={healthy ? "green" : "warning"}>
				{healthy ? "Healthy" : instance.ready ? "Degraded" : "Not ready"}
			</Badge>
			<span>
				Node {instance.node ?? "Not reported"}
				{instance.zone ? ` · ${instance.zone}` : ""}
			</span>
			{!primary && (
				<span>
					{replicationLabel(instance)}
					{instance.lagBytes === null && " · lag not reported"}
				</span>
			)}
		</TopologyNode>
	);
}

export function DatabaseTopology({ report }: { report: PersistenceReport }) {
	const {
		coderDatabase,
		configuration,
		cluster,
		instances,
		database,
		backups,
	} = report.facts;
	const now = useNow();
	const [host, namespace] = coderDatabase.host?.split(".") ?? [];
	const endpoint = configuration?.resources.find(
		(resource) =>
			resource.kind === "Service" &&
			resource.name === host &&
			(!namespace || resource.namespace === namespace),
	);
	const reachability = report.checks.find(
		(check) => check.id === "db.reachable",
	);
	const connectionStatus =
		reachability?.status === "error"
			? "Unreachable"
			: reachability?.status === "ok" || database
				? "Reachable"
				: "Unknown";
	const primary = instances.find((instance) => instance.role === "primary");
	const replicas = instances.filter((instance) => instance.role === "replica");
	const healthyReplicas = replicas.filter(replicaHealthy).length;
	const primaryNode = primary?.node;
	const sharedNode = primaryNode
		? replicas.filter((instance) => instance.node === primaryNode).length
		: 0;
	const replicaNodes = new Set(
		replicas.flatMap((instance) => (instance.node ? [instance.node] : [])),
	);
	return (
		<section
			className="dashboard-panel flex flex-col gap-4"
			aria-labelledby="database-topology-title"
		>
			<h2 id="database-topology-title" className="m-0 text-base font-semibold">
				Database topology
			</h2>
			<div className="mx-auto flex w-full max-w-5xl flex-col items-center">
				<div className="w-full max-w-56">
					<TopologyNode designation="Application" name="Coder">
						<span>Database role {coderDatabase.user ?? "Not reported"}</span>
						<span>TLS mode {coderDatabase.sslMode ?? "Default"}</span>
					</TopologyNode>
				</div>
				<TopologyConnection label="Database connection" />
				<div className="w-full max-w-xs">
					<TopologyNode
						designation={
							endpoint ? "Kubernetes Service" : "Configured endpoint"
						}
						name={coderDatabase.host ?? "Unknown endpoint"}
					>
						<Badge
							size="xs"
							variant={
								connectionStatus === "Reachable"
									? "green"
									: connectionStatus === "Unreachable"
										? "destructive"
										: "default"
							}
						>
							{connectionStatus}
						</Badge>
						<span>
							Port{" "}
							{coderDatabase.port ??
								(coderDatabase.host ? 5432 : "Not reported")}
						</span>
					</TopologyNode>
				</div>
				{(primary || replicas.length > 0) && (
					<>
						<TopologyConnection
							label={primary ? "Cluster primary" : "Primary not reported"}
							dashed={!primary}
						/>
						<div className="w-full max-w-sm">
							{primary ? (
								<DatabaseInstanceNode instance={primary} />
							) : (
								<TopologyNode
									designation="PostgreSQL primary"
									name="Not reported"
								>
									<span>Replica details are available below.</span>
								</TopologyNode>
							)}
						</div>
					</>
				)}
				{replicas.length > 0 && (
					<div className="relative w-full">
						<div
							aria-hidden
							className="mx-auto h-5 w-px border-0 border-l border-dashed border-content-secondary"
						/>
						<p className="m-0 text-center text-xs text-content-secondary">
							{primary ? "WAL replication" : "Discovered replicas"} ·{" "}
							{healthyReplicas} of {replicas.length} healthy
						</p>
						{replicas.length > 1 && (
							<div
								aria-hidden
								className="mx-auto hidden border-0 border-t border-dashed border-content-secondary lg:block"
								style={{ width: `${100 * (1 - 1 / replicas.length)}%` }}
							/>
						)}
						<ul
							className="m-0 grid list-none gap-3 p-0 sm:[grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))] lg:gap-0 lg:[grid-template-columns:repeat(var(--replica-columns),minmax(0,1fr))]"
							style={
								{ "--replica-columns": replicas.length } as React.CSSProperties
							}
						>
							{replicas.map((instance) => (
								<li key={instance.name} className="min-w-0 lg:px-1.5">
									<div
										aria-hidden
										className="flex flex-col items-center text-content-secondary"
									>
										<div className="h-3 border-0 border-l border-dashed border-content-secondary" />
										<ChevronDownIcon className="size-4" />
									</div>
									<DatabaseInstanceNode instance={instance} />
								</li>
							))}
						</ul>
					</div>
				)}
				{!instances.length && (
					<p className="mt-3 mb-0 text-center text-sm text-content-secondary">
						{report.mode === "external"
							? "The external database does not report instances to this cluster."
							: "Database instances were not reported."}
					</p>
				)}
			</div>
			{(replicas.length > 0 || cluster || backups) && (
				<div className="grid gap-3 sm:grid-cols-2">
					{replicas.length > 0 && (
						<TopologyNode
							designation="Failure domains"
							name="Replica placement"
						>
							<span>
								{replicaNodes.size} known replica{" "}
								{replicaNodes.size === 1 ? "node" : "nodes"}
							</span>
							{sharedNode > 0 && (
								<span className="text-content-warning">
									{sharedNode}{" "}
									{sharedNode === 1 ? "replica shares" : "replicas share"} the
									primary’s node. A node outage would affect both roles.
								</span>
							)}
							{replicas.some((instance) => !instance.node) && (
								<span>Some replica locations are unknown.</span>
							)}
						</TopologyNode>
					)}
					{(cluster || backups) && (
						<TopologyNode designation="Recoverability" name="Backups">
							<span>
								{backups?.configured
									? `${backups.method ?? "Configured"} · ${backups.schedule ?? "No schedule reported"}`
									: "No backup schedule reported"}
							</span>
							<span>
								Last successful backup{" "}
								{backups?.lastSuccess
									? `${ago(backups.lastSuccess, now)} ago`
									: "not reported"}
							</span>
							{backups?.recoverableSince && (
								<span>
									Recovery window begins{" "}
									{new Date(backups.recoverableSince).toLocaleString()}
								</span>
							)}
						</TopologyNode>
					)}
				</div>
			)}
		</section>
	);
}
