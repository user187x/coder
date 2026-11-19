import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import type { DatabaseConfiguration, PersistenceReport } from "#/api/platform";
import { Badge } from "#/components/Badge/Badge";
import { SearchField } from "#/components/SearchField/SearchField";
import { bytes } from "#/modules/platform/ClusterVisuals";
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

export function DatabaseTopology({ report }: { report: PersistenceReport }) {
	const {
		coderDatabase,
		configuration,
		cluster,
		instances,
		database,
		backups,
	} = report.facts;
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
	return (
		<section
			className="dashboard-panel flex flex-col gap-4"
			aria-labelledby="database-topology-title"
		>
			<h2 id="database-topology-title" className="m-0 text-base font-semibold">
				Database topology
			</h2>
			<div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,2fr)]">
				<TopologyNode designation="Client" name="Coder">
					<span>Database role {coderDatabase.user ?? "Not reported"}</span>
					<span>TLS mode {coderDatabase.sslMode ?? "Default"}</span>
				</TopologyNode>
				<ArrowRightIcon
					aria-hidden
					className="size-4 self-center rotate-90 justify-self-center text-content-secondary lg:rotate-0"
				/>
				<TopologyNode
					designation={endpoint ? "Kubernetes Service" : "Configured endpoint"}
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
						Service IP {endpoint?.values["spec.clusterIP"] ?? "Not reported"}
					</span>
					<span>
						Port{" "}
						{coderDatabase.port ?? (coderDatabase.host ? 5432 : "Not reported")}
					</span>
				</TopologyNode>
				<ArrowRightIcon
					aria-hidden
					className="size-4 self-center rotate-90 justify-self-center text-content-secondary lg:rotate-0"
				/>
				<div className="grid min-w-0 gap-3">
					{instances.length ? (
						instances.map((instance) => {
							const healthy = replicaHealthy(instance);
							return (
								<TopologyNode
									key={instance.name}
									designation={
										instance.role === "primary" ? "Primary · writes" : "Replica"
									}
									name={instance.name}
								>
									<Badge size="xs" variant={healthy ? "green" : "warning"}>
										{healthy
											? "Healthy"
											: instance.ready
												? "Degraded"
												: "Not ready"}
									</Badge>
									<span>Pod IP {instance.podIP ?? "Not reported"}</span>
									<span>Node {instance.node ?? "Not reported"}</span>
									<span>
										Storage{" "}
										{instance.pvc?.storageClass ??
											cluster?.storageClass ??
											"Not reported"}{" "}
										· {bytes(instance.pvc?.capacityBytes)}
									</span>
									{instance.role === "replica" && (
										<span>Replication {replicationLabel(instance)}</span>
									)}
								</TopologyNode>
							);
						})
					) : (
						<TopologyNode
							designation="PostgreSQL"
							name={
								report.mode === "external"
									? "External database"
									: "Instances unknown"
							}
						>
							<span>Instance details are not reported by this cluster.</span>
						</TopologyNode>
					)}
				</div>
			</div>
			{cluster && (
				<div className="rounded-lg border border-solid border-border bg-surface-primary p-3 text-sm">
					<strong>Recovery</strong>
					<span className="ml-2 text-content-secondary">
						{backups?.configured
							? `${backups.method ?? "Backups configured"} · ${backups.schedule ?? "No schedule reported"}`
							: "No backup schedule reported"}
					</span>
				</div>
			)}
		</section>
	);
}
