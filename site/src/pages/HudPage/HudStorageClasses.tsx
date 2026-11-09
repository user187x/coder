import type { ClusterUsage, HudStorage } from "#/api/platform";

const gib = (value: number | null) =>
	value === null
		? "Unavailable"
		: `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} GiB`;

type Capacity = Pick<ClusterUsage, "cpu" | "memory" | "live">;
const quantity = (value: number | null, unit: string) =>
	value === null
		? "Unavailable"
		: `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;

function ClusterCapacity({
	storage,
	cluster,
}: {
	storage: HudStorage;
	cluster?: Capacity | null;
}) {
	const memory = cluster?.memory;
	const rows = [
		{
			label: "CPU",
			total: cluster?.cpu.total ?? null,
			used: cluster?.live ? cluster.cpu.used : null,
			unit: "cores",
		},
		{
			label: "Memory",
			total: memory ? memory.total / 2 ** 30 : null,
			used: memory && cluster?.live ? memory.used / 2 ** 30 : null,
			unit: "GiB",
		},
		{ label: "Disk", total: storage.total, used: storage.used, unit: "GiB" },
	];
	return (
		<article className="min-w-0 rounded-lg border border-solid border-border bg-surface-primary p-4">
			<h3 className="m-0 text-sm font-semibold">Cluster capacity</h3>
			<p className="mt-1 text-xs text-content-secondary">
				Used and total across ready nodes
			</p>
			<dl className="m-0 grid gap-3">
				{rows.map(({ label, used, total, unit }) => (
					<div key={label} className="grid gap-1">
						<div className="flex flex-wrap justify-between gap-x-2 text-xs">
							<dt>{label}</dt>
							<dd className="m-0 tabular-nums">
								{quantity(used, unit)} / {quantity(total, unit)}
							</dd>
						</div>
						<div
							aria-hidden
							className="h-2 overflow-hidden rounded bg-surface-tertiary"
						>
							{used !== null && total !== null && total > 0 && (
								<div
									className="h-full rounded bg-content-link"
									style={{ width: `${Math.min(100, (100 * used) / total)}%` }}
								/>
							)}
						</div>
					</div>
				))}
			</dl>
		</article>
	);
}

export const HudStorageClasses = ({
	storage,
	cluster,
	handle,
}: {
	storage: HudStorage;
	cluster?: Capacity | null;
	handle?: React.ReactNode;
}) => (
	<section className="rounded-lg border border-solid border-border p-4 bg-surface-primary">
		<header className="mb-3 flex items-center justify-between gap-2">
			<h2 className="m-0 text-base font-medium">Storage classes</h2>
			{handle}
		</header>
		<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
			{!storage.inventoryAvailable ? (
				<p role="status">Storage inventory is unavailable.</p>
			) : storage.classes.length === 0 ? (
				<p>No persistent volumes or claims.</p>
			) : null}
			{storage.classes.map((group) => (
				<article
					key={group.name}
					className="min-w-0 rounded-lg border border-solid border-border bg-surface-primary p-4"
				>
					<h3 className="m-0 text-sm font-semibold">{group.name}</h3>
					<p className="mt-1 text-xs text-content-secondary">
						{group.volumes} volumes · {group.claims} claims
					</p>
					<dl className="m-0 grid gap-3">
						{(
							[
								["Capacity", group.capacity],
								["Claimed", group.claimed],
								["Measured usage", group.used],
							] as const
						).map(([label, value]) => (
							<div key={label} className="grid gap-1">
								<div className="flex justify-between text-xs">
									<dt>{label}</dt>
									<dd className="m-0 tabular-nums">{gib(value)}</dd>
								</div>
								<div
									aria-hidden
									className="h-2 overflow-hidden rounded bg-surface-tertiary"
								>
									{typeof value === "number" && (
										<div
											className="h-full rounded bg-content-link"
											style={{
												width: `${(100 * value) / Math.max(1, group.capacity, group.claimed, group.used ?? 0)}%`,
											}}
										/>
									)}
								</div>
							</div>
						))}
					</dl>
					<p className="mb-0 text-xs text-content-secondary">
						Usage measured for {group.measuredClaims} of {group.claims} claims
					</p>
				</article>
			))}
			<ClusterCapacity storage={storage} cluster={cluster} />
		</div>
	</section>
);
