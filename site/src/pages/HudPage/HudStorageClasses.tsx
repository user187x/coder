import type { HudStorage } from "#/api/platform";

const gib = (value: number | null) =>
	value === null
		? "Unavailable"
		: `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} GiB`;

export const HudStorageClasses = ({ storage }: { storage: HudStorage }) => (
	<section className="rounded-lg border border-solid border-border p-4">
		<h2 className="m-0 text-base font-medium">Storage classes</h2>
		<p className="text-xs text-content-secondary">
			Physical totals cover ready nodes' root filesystems. PVC requests and
			persistent volume capacity can use remote or thin-provisioned storage.
			Usage covers measured claims only; unmounted claims may have no reading.
		</p>
		{!storage.inventoryAvailable ? (
			<p role="status">Storage inventory is unavailable.</p>
		) : storage.classes.length === 0 ? (
			<p>No persistent volumes or claims.</p>
		) : (
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
			</div>
		)}
	</section>
);
