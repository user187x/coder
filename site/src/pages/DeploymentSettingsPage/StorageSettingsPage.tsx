import {
	ArrowRightIcon,
	DatabaseIcon,
	HardDriveIcon,
	LayersIcon,
	Link2Icon,
	RefreshCwIcon,
	ServerIcon,
	ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "react-query";
import { Link, useLocation } from "react-router";
import { clusterHA, type StorageReport } from "#/api/clusterNetwork";
import type { PersistenceReport } from "#/api/platform";
import { persistenceReport } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
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
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { RequirePermission } from "#/modules/permissions/RequirePermission";
import { bytes, LiveStatus, useNow } from "#/modules/platform/ClusterVisuals";
import { pageTitle } from "#/utils/page";
import {
	CloudDrivePart,
	StoragePart,
} from "./NetworkSettingsPage/CodeServerHACard";
import { EntityProvider } from "./NetworkSettingsPage/EntityDetails";
import { DatabaseOperations } from "./PersistenceSettingsPage/PersistenceView";

const StorageSettingsPage = () => {
	const { permissions } = useAuthenticated();
	return (
		<RequirePermission isFeatureVisible={permissions.viewDeploymentConfig}>
			<title>{pageTitle("Storage")}</title>
			<StorageView />
		</RequirePermission>
	);
};

export function StorageView() {
	const [paused, setPaused] = useState(false);
	const database = useQuery(persistenceReport(paused, true));
	const query = useQuery(clusterHA(paused));
	const storage = query.data?.storage;
	const now = useNow();
	const { hash } = useLocation();

	const databaseReady = Boolean(database.data);
	const storageReady = Boolean(storage);
	useEffect(() => {
		if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.();
	}, [hash, databaseReady, storageReady]);

	return (
		<EntityProvider>
			<div className="flex min-w-0 flex-col gap-6 pb-6">
				<header className="dashboard-panel flex flex-wrap items-center justify-between gap-3">
					<h1 className="m-0 text-xl font-semibold">Storage</h1>
					<div className="flex flex-wrap items-center gap-2">
						<LiveStatus
							paused={paused}
							updatedAt={Math.max(query.dataUpdatedAt, database.dataUpdatedAt)}
						/>
						<Button
							size="sm"
							variant="outline"
							aria-pressed={paused}
							onClick={() => setPaused(!paused)}
						>
							{paused ? "Resume" : "Pause"}
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={query.isFetching || database.isFetching}
							onClick={() => {
								void query.refetch();
								void database.refetch();
							}}
						>
							<RefreshCwIcon aria-hidden /> Refresh
						</Button>
					</div>
				</header>
				{storage && (
					<StorageOverview storage={storage} database={database.data} />
				)}
				<DatabaseOperations
					reportQuery={database}
					paused={paused}
					setPaused={setPaused}
					storage
					hasStorageClasses={Boolean(storage?.classes.length)}
				/>
				{query.isLoading && <Loader />}
				{query.error && <ErrorAlert error={query.error} />}
				{query.data && !storage && (
					<ErrorAlert
						error={
							new Error(
								query.data.storageError ?? "Could not read cluster storage",
							)
						}
					/>
				)}
				{storage && (
					<>
						{(storage.classes.length > 0 || !database.data) && (
							<section
								className="dashboard-panel"
								aria-labelledby="storage-classes"
							>
								<StoragePart storage={storage} facts={database.data?.facts} />
							</section>
						)}
						<VolumeInventory storage={storage} />
						{storage.cloudDrive && (
							<section
								className="dashboard-panel"
								aria-labelledby="cloud-drive"
							>
								<CloudDrivePart cd={storage.cloudDrive} now={now} />
							</section>
						)}
					</>
				)}
			</div>
		</EntityProvider>
	);
}

function StorageOverview({
	storage,
	database,
}: {
	storage: StorageReport;
	database?: PersistenceReport;
}) {
	const cluster = database?.facts.cluster;
	const pendingClaims = storage.claims?.filter(
		(claim) => claim.phase === "Pending",
	).length;
	const findings = database?.checks.filter(
		(check) => check.status === "error" || check.status === "warn",
	).length;
	const capacity = storage.classes.reduce(
		(total, c) => total + c.capacityBytes,
		0,
	);
	const activeClasses = storage.classes.filter((c) => c.capacityBytes > 0);
	return (
		<section
			className="dashboard-panel flex flex-col gap-4"
			aria-label="Storage overview"
		>
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
				{[
					{
						icon: DatabaseIcon,
						title: "Database topology",
						value: cluster
							? `${cluster.readyInstances}/${cluster.instances} ready`
							: (database?.facts.provider ?? "Inspect"),
						anchor: "#database-map",
					},
					{
						icon: ShieldCheckIcon,
						title: "Disaster recovery",
						value: "Manage backups",
						anchor: "#disaster-recovery",
					},
					{
						icon: LayersIcon,
						title: "Storage classes",
						value: storage.classes.length,
						anchor: "#storage-classes",
					},
					{
						icon: HardDriveIcon,
						title: "Persistent volumes",
						value: storage.volumes?.length ?? "Unavailable",
						anchor: "#volume-inventory",
					},
					{
						icon: Link2Icon,
						title: "Cloud Drive",
						value: storage.cloudDrive
							? `${storage.cloudDrive.volumes.inUse} mounted`
							: "Unavailable",
						anchor: "#cloud-drive",
					},
				].map(({ icon: Icon, title, value, anchor }) => (
					<Link
						key={title}
						to={anchor}
						preventScrollReset
						className="group flex items-center gap-3 rounded-xl border border-border bg-surface-primary p-4 text-content-primary no-underline hover:border-content-link focus-visible:outline-content-link"
					>
						<Icon aria-hidden className="size-5 text-content-link" />
						<span className="flex flex-col gap-1">
							<span className="text-xs text-content-secondary group-hover:text-content-link">
								{title}
							</span>
							<strong className="text-base">{value}</strong>
						</span>
					</Link>
				))}
			</div>
			{(Boolean(findings) || Boolean(pendingClaims)) && (
				<div className="flex flex-wrap gap-2 text-sm">
					{Boolean(findings) && (
						<Button
							asChild
							size="sm"
							variant="outline"
							className="text-content-warning"
						>
							<Link to="#database-checks" preventScrollReset>
								Database checks to review ({findings})
							</Link>
						</Button>
					)}
					{Boolean(pendingClaims) && (
						<Button
							asChild
							size="sm"
							variant="outline"
							className="text-content-warning"
						>
							<Link to="#pending-claims" preventScrollReset>
								Pending claims ({pendingClaims})
							</Link>
						</Button>
					)}
				</div>
			)}

			{capacity > 0 && (
				<div className="rounded-xl border border-border bg-surface-primary p-4">
					<div className="mb-2 flex justify-between gap-2 text-sm">
						<strong>Bound capacity by storage class</strong>
						<span>{bytes(capacity)}</span>
					</div>
					<div
						className="flex h-2 gap-0.5 overflow-hidden rounded-full"
						aria-hidden
					>
						{activeClasses.map((c, index) => (
							<div
								key={c.name}
								className={capacityColor(index)}
								style={{ flexGrow: c.capacityBytes / capacity, flexBasis: 0 }}
							/>
						))}
					</div>
					<ul className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-xs">
						{activeClasses.map((c, index) => (
							<li key={c.name} className="flex items-center gap-2">
								<span
									aria-hidden
									className={`size-2 rounded-full ${capacityColor(index)}`}
								/>
								<Link
									className="text-content-link"
									to={`#storage-class-${c.name}`}
									preventScrollReset
								>
									{c.name} · {bytes(c.capacityBytes)}
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}

function capacityColor(index: number) {
	return [
		"bg-content-link",
		"bg-content-success",
		"bg-content-warning",
		"bg-content-secondary",
	][index % 4];
}

function VolumeInventory({ storage }: { storage: StorageReport }) {
	const [search, setSearch] = useState("");
	const [phase, setPhase] = useState<string | null>(null);
	const [binding, setBinding] = useState<{
		claim: string;
		volume: string;
	} | null>(null);
	const filter = search.trim().toLowerCase();
	const phases = new Map<string, number>();
	for (const entry of [...(storage.claims ?? []), ...(storage.volumes ?? [])]) {
		const status = entry.phase ?? "Unknown";
		phases.set(status, (phases.get(status) ?? 0) + 1);
	}
	const volume = storage.volumes?.find(
		(entry) => entry.name === binding?.volume,
	);
	const claim = storage.claims?.find(
		(entry) => `${entry.namespace}/${entry.name}` === binding?.claim,
	);
	const storageClass = volume?.storageClass || claim?.storageClass;
	const inspect = (claim: string, volume: string) => {
		setBinding({ claim, volume });
		setSearch("");
		setPhase(null);
	};
	const matches = (fields: (string | null)[]) =>
		fields.some((field) => field?.toLowerCase().includes(filter));
	return (
		<section
			id="volume-inventory"
			className="dashboard-panel flex min-w-0 scroll-mt-6 flex-col gap-4"
			aria-labelledby="volume-inventory-title"
		>
			<h2 id="volume-inventory-title" className="m-0 text-base font-semibold">
				Volume inventory
			</h2>
			<div
				role="group"
				aria-label="Filter by phase"
				className="flex flex-wrap gap-2"
			>
				<Button
					size="sm"
					variant="outline"
					aria-pressed={!phase}
					onClick={() => {
						setPhase(null);
						setBinding(null);
					}}
				>
					All resources
				</Button>
				{[...phases]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([status, count]) => (
						<Button
							key={status}
							id={status === "Pending" ? "pending-claims" : undefined}
							size="sm"
							variant="outline"
							aria-pressed={phase === status}
							onClick={() => {
								setPhase(status);
								setBinding(null);
							}}
							className="scroll-mt-10 target:border-content-warning aria-pressed:border-content-link aria-pressed:text-content-link"
						>
							{status} <span className="tabular-nums">{count}</span>
						</Button>
					))}
			</div>
			{binding && (
				<div
					className="flex flex-col gap-3 rounded-xl border border-content-link bg-surface-primary p-4 text-sm"
					role="region"
					aria-label="Volume binding"
				>
					<div className="flex items-center justify-between gap-2">
						<strong>Volume binding</strong>
						<Button
							size="sm"
							variant="outline"
							onClick={() => setBinding(null)}
						>
							Clear binding
						</Button>
					</div>
					<div className="flex flex-col gap-2 md:flex-row md:items-center">
						{[
							{
								icon: Link2Icon,
								label: "Persistent volume claim",
								name: binding.claim,
								detail: claim?.phase,
							},
							{
								icon: HardDriveIcon,
								label: "Persistent volume",
								name: binding.volume,
								detail: volume?.capacity,
							},
							{
								icon: LayersIcon,
								label: "Storage class",
								name: storageClass || "No class",
								detail: volume?.driver,
							},
							{
								icon: ServerIcon,
								label: "Referencing pods",
								name:
									(claim?.usedBy ?? volume?.usedBy)?.join(", ") ||
									"None reported",
								detail: null,
							},
						].map(({ icon: Icon, label, name, detail }, index) => (
							<div
								key={label}
								className="flex min-w-0 flex-1 flex-col items-stretch gap-2 md:flex-row md:items-center"
							>
								{index > 0 && (
									<ArrowRightIcon
										aria-hidden
										className="mx-auto size-4 shrink-0 rotate-90 text-content-secondary md:rotate-0"
									/>
								)}
								<div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-border bg-surface-secondary p-3">
									<span className="flex items-center gap-2 text-xs text-content-secondary">
										<Icon aria-hidden className="size-4 text-content-link" />
										{label}
									</span>
									<span className="wrap-anywhere font-mono text-xs">
										{name}
									</span>
									{detail && (
										<small className="text-content-secondary">{detail}</small>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			<label className="flex flex-wrap items-center gap-2 text-sm">
				Filter volumes and claims
				<input
					type="search"
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setBinding(null);
					}}
					className="rounded-md border border-border bg-surface-primary px-2 py-1"
					placeholder="Name, namespace, class, or phase"
				/>
			</label>
			<InventoryTable
				title="Persistent volume claims (PVCs)"
				unavailable={
					storage.claimScope ? undefined : "Claim inventory is unavailable."
				}
				scope={storage.claimScope ?? undefined}
				headers={[
					"Namespace / claim",
					"Phase",
					"Storage class",
					"Backing PV",
					"Requested / capacity",
					"Access modes",
					"Pod references",
				]}
				rows={(storage.claims ?? [])
					.filter(
						(r) =>
							(!phase || (r.phase ?? "Unknown") === phase) &&
							(!binding || binding.claim === `${r.namespace}/${r.name}`) &&
							matches([r.name, r.namespace, r.storageClass, r.phase, r.volume]),
					)
					.map((r) => {
						const key = `${r.namespace}/${r.name}`;
						return {
							key,
							cells: [
								key,
								r.phase,
								r.storageClass,
								r.volume ? (
									<BindingButton
										key={r.volume}
										name={r.volume}
										inspect={() => inspect(key, r.volume ?? "")}
									/>
								) : null,
								`${r.requested ?? "N/A"} / ${r.capacity ?? "N/A"}`,
								r.accessModes.join(", "),
								r.usedBy.join(", "),
							],
						};
					})}
			/>
			<InventoryTable
				title="Persistent volumes (PVs)"
				unavailable={
					storage.volumesReadable && storage.volumes
						? undefined
						: "Volume inventory is unavailable."
				}
				headers={[
					"Volume",
					"Phase",
					"Storage class",
					"Bound claim",
					"Capacity",
					"Access modes",
					"Reclaim policy",
					"CSI driver",
					"Pod references",
				]}
				rows={(storage.volumes ?? [])
					.filter(
						(r) =>
							(!phase || (r.phase ?? "Unknown") === phase) &&
							(!binding || binding.volume === r.name) &&
							matches([r.name, r.storageClass, r.phase, r.claim, r.driver]),
					)
					.map((r) => ({
						key: r.name,
						cells: [
							r.name,
							r.phase,
							r.storageClass,
							r.claim ? (
								<BindingButton
									key={r.claim}
									name={r.claim}
									inspect={() => inspect(r.claim ?? "", r.name)}
								/>
							) : null,
							r.capacity,
							r.accessModes.join(", "),
							r.reclaimPolicy,
							r.driver,
							r.usedBy.join(", "),
						],
					}))}
			/>
		</section>
	);
}

function BindingButton({
	name,
	inspect,
}: {
	name: string;
	inspect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={inspect}
			aria-label={`Inspect binding to ${name}`}
			className="cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-xs text-content-link underline"
		>
			{name}
		</button>
	);
}

function InventoryTable({
	title,
	unavailable,
	scope,
	headers,
	rows,
}: {
	title: string;
	unavailable?: string;
	scope?: string;
	headers: string[];
	rows: { key: string; cells: React.ReactNode[] }[];
}) {
	return (
		<div className="min-w-0">
			<h3 className="mb-2 mt-0 text-sm font-semibold">{title}</h3>
			{scope && (
				<p className="text-xs text-content-secondary">Scope: {scope}</p>
			)}
			{unavailable || !rows.length ? (
				<p className="text-sm text-content-secondary">
					{unavailable ?? "No matching resources."}
				</p>
			) : (
				<div className="overflow-x-auto">
					<Table aria-label={title}>
						<TableHeader>
							<TableRow>
								{headers.map((header) => (
									<TableHead key={header}>{header}</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map(({ key, cells }) => (
								<TableRow key={key}>
									{cells.map((cell, index) => (
										<TableCell key={headers[index]}>{cell || "N/A"}</TableCell>
									))}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}

export default StorageSettingsPage;
