import type { PersistenceReport, StorageClassInfo } from "#/api/platform";
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
	StatusDot,
	useNow,
} from "#/modules/platform/ClusterVisuals";
import { replicaHealthy, replicationLabel } from "./PersistenceMap";

export const InstancesTable: React.FC<{ report: PersistenceReport }> = ({
	report,
}) => {
	const now = useNow();
	const { instances, cluster } = report.facts;
	return (
		<section
			aria-labelledby="persistence-instances"
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="persistence-instances" className="m-0 text-base font-semibold">
					Instances
				</h2>
				{cluster && (
					<span className="text-xs text-content-secondary">
						{cluster.namespace}/{cluster.name} ·{" "}
						{cluster.phase ?? "phase unknown"}
						{cluster.image ? ` · ${cluster.image}` : ""}
					</span>
				)}
			</div>
			<div className="overflow-x-auto">
				<Table aria-label="Database instances">
					<TableHeader>
						<TableRow>
							{[
								"Instance",
								"Role",
								"Status",
								"Node",
								"Zone",
								"Pod IP",
								"Volume",
								"Storage class",
								"Capacity",
								"Replication",
								"Restarts",
								"Up",
							].map((h) => (
								<TableHead key={h}>{h}</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{instances.length ? (
							instances.map((i) => {
								const ok = i.role === "primary" ? i.ready : replicaHealthy(i);
								return (
									<TableRow key={i.name} className="whitespace-nowrap">
										<TableCell>{i.name}</TableCell>
										<TableCell>
											{i.role === "primary" ? "Primary" : "Replica"}
										</TableCell>
										<TableCell>
											<StatusDot
												status={!i.ready ? "error" : ok ? "ok" : "warn"}
											>
												{i.ready ? "Ready" : "Not ready"}
											</StatusDot>
										</TableCell>
										<TableCell className="font-mono text-xs">
											{i.node ?? "N/A"}
										</TableCell>
										<TableCell>{i.zone ?? "N/A"}</TableCell>
										<TableCell className="font-mono text-xs">
											{i.podIP ?? "N/A"}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{i.pvc?.name ?? "N/A"}
										</TableCell>
										<TableCell>{i.pvc?.storageClass ?? "N/A"}</TableCell>
										<TableCell className="text-right tabular-nums">
											{bytes(i.pvc?.capacityBytes)}
										</TableCell>
										<TableCell>{replicationLabel(i)}</TableCell>
										<TableCell className="text-right tabular-nums">
											{i.restarts}
										</TableCell>
										<TableCell
											className="text-right tabular-nums"
											data-pixel="ignore"
										>
											{ago(i.started, now)}
										</TableCell>
									</TableRow>
								);
							})
						) : (
							<TableEmpty message="No CloudNativePG instances serve Coder's database." />
						)}
					</TableBody>
				</Table>
			</div>
		</section>
	);
};

const KIND_LABELS: Record<StorageClassInfo["kind"], string> = {
	cloud: "Cloud disk",
	network: "Network storage",
	local: "Node-local disk",
	unknown: "Unknown",
};

const KIND_NOTES: Record<StorageClassInfo["kind"], string> = {
	cloud:
		"Replicated by the cloud provider inside a zone; survives losing a node.",
	network: "Replicated by the storage system; survives losing a node.",
	local: "Stays on one node; rely on database replicas and backups.",
	unknown: "Check how the provisioner protects data.",
};

export const StorageClassesTable: React.FC<{ report: PersistenceReport }> = ({
	report,
}) => {
	const { storageClasses, snapshotClasses, cluster } = report.facts;
	return (
		<section
			aria-labelledby="persistence-storage"
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="persistence-storage" className="m-0 text-base font-semibold">
					Storage classes
				</h2>
				<span className="text-xs text-content-secondary">
					Snapshot classes:{" "}
					{snapshotClasses.length ? snapshotClasses.join(", ") : "none"}
				</span>
			</div>
			<div className="overflow-x-auto">
				<Table aria-label="Storage classes">
					<TableHeader>
						<TableRow>
							{[
								"Class",
								"Backed by",
								"Kind",
								"Grows in place",
								"Reclaim",
								"Binding",
								"What it means",
							].map((h) => (
								<TableHead key={h}>{h}</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{storageClasses.length ? (
							storageClasses.map((c) => {
								const used =
									c.name === cluster?.storageClass ||
									(Boolean(cluster) && !cluster?.storageClass && c.isDefault);
								return (
									<TableRow key={c.name}>
										<TableCell className="whitespace-nowrap">
											{c.name}
											{c.isDefault ? " (default)" : ""}
											{used ? " · Coder's database" : ""}
										</TableCell>
										<TableCell>
											{c.label}
											<div className="font-mono text-xs text-content-secondary">
												{c.provisioner}
											</div>
										</TableCell>
										<TableCell>{KIND_LABELS[c.kind]}</TableCell>
										<TableCell>{c.allowExpansion ? "Yes" : "No"}</TableCell>
										<TableCell>{c.reclaimPolicy ?? "N/A"}</TableCell>
										<TableCell>{c.bindingMode ?? "N/A"}</TableCell>
										<TableCell className="text-xs text-content-secondary">
											{KIND_NOTES[c.kind]}
											{c.reclaimPolicy === "Delete"
												? " Deleting a volume deletes its data."
												: ""}
										</TableCell>
									</TableRow>
								);
							})
						) : (
							<TableEmpty message="No storage classes are readable here." />
						)}
					</TableBody>
				</Table>
			</div>
		</section>
	);
};
