import { getErrorMessage } from "#/api/errors";
import type { HudHistory, HudHistoryPoint } from "#/api/platform";

const measured = (value: number | null | undefined): number | null =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;

/** PVC requests can overlap physical usage or belong to remote storage, so they are not added to the stack. */
export const diskAmounts = (point: Partial<HudHistoryPoint> | undefined) => {
	const used = measured(point?.diskUsed);
	const total = measured(point?.diskTotal);
	return {
		used,
		total,
		claimed: measured(point?.diskClaimed),
		remaining:
			used !== null && total !== null ? Math.max(0, total - used) : null,
	};
};

const formatDisk = (value: number | null) =>
	value === null
		? "Unknown"
		: `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} GiB`;

const timeLabel = (seconds: number) =>
	new Date(seconds * 1000).toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});

/** Physical disk history, with independent PVC claim markers on the same GiB scale. */
export const ClusterDiskGraph: React.FC<{
	history?: HudHistory;
	loading?: boolean;
	error?: unknown;
}> = ({ history, loading = false, error }) => {
	const points = history?.points ?? [];
	const latest = points.at(-1);
	const current = diskAmounts(latest);
	const scale = Math.max(
		1,
		...points.flatMap((point) => {
			const { used, total, claimed } = diskAmounts(point);
			return [used ?? 0, total ?? 0, claimed ?? 0];
		}),
	);
	const hasMeasurements = points.some((point) =>
		[point.diskUsed, point.diskTotal, point.diskClaimed].some(
			(value) => measured(value) !== null,
		),
	);
	const span = history
		? Math.max(history.step, history.end - history.start)
		: 900;
	const slot = history ? (history.step / span) * 100 : 100 / 60;
	const height = (value: number) => (value / scale) * 38;
	const summary = `${formatDisk(current.used)} used, ${formatDisk(current.claimed)} claimed, ${formatDisk(current.total)} total size`;

	return (
		<div className="mt-3 min-w-0 text-2xs text-content-secondary">
			<div className="mb-1 flex justify-between items-baseline gap-2">
				<span className="font-semibold text-content-primary">Disk</span>
				{latest && <span>Measured {timeLabel(latest.t)}</span>}
			</div>
			{loading && !history ? (
				<p className="m-0 py-3" role="status">
					Loading disk history...
				</p>
			) : error && !history ? (
				<p className="m-0 text-content-destructive">
					{getErrorMessage(
						error,
						"Disk history is unavailable. It will retry automatically.",
					)}
				</p>
			) : (
				<>
					<div className="grid grid-cols-3 gap-2 mb-1 tabular-nums">
						<div>
							<span className="text-content-link">Used</span>
							<div>{formatDisk(current.used)}</div>
						</div>
						<div title="PVC storage requests, including remote and thin-provisioned volumes">
							<span className="text-content-warning">Claimed</span>
							<div>{formatDisk(current.claimed)}</div>
						</div>
						<div>
							<span>Total size</span>
							<div>{formatDisk(current.total)}</div>
						</div>
					</div>
					{hasMeasurements && history ? (
						<svg
							role="img"
							aria-label={`Cluster disk over the last ${Math.round(span / 60)} minutes: ${summary}. Used and remaining capacity are stacked; claims are separate markers.`}
							viewBox="0 0 100 40"
							preserveAspectRatio="none"
							className="block h-10 w-full overflow-hidden rounded bg-surface-tertiary"
						>
							{points.map((point) => {
								const { used, total, claimed, remaining } = diskAmounts(point);
								const x =
									((point.t - history.start) / span) * 100 + slot * 0.15;
								const width = slot * 0.7;
								return (
									<g key={point.t}>
										<title>{`${timeLabel(point.t)}: ${formatDisk(used)} used, ${formatDisk(claimed)} claimed, ${formatDisk(total)} total size`}</title>
										{total !== null && (
											<rect
												x={x}
												width={width}
												y={39 - height(total)}
												height={height(remaining ?? total)}
												className="fill-content-secondary/25"
											/>
										)}
										{used !== null && (
											<rect
												x={x}
												width={width}
												y={39 - height(used)}
												height={height(used)}
												className="fill-content-link"
											/>
										)}
										{claimed !== null && (
											<line
												x1={x}
												x2={x + width}
												y1={39 - height(claimed)}
												y2={39 - height(claimed)}
												className="stroke-content-warning"
												strokeWidth={1.5}
												vectorEffect="non-scaling-stroke"
											/>
										)}
									</g>
								);
							})}
						</svg>
					) : (
						<p className="m-0 py-2">No disk measurements available.</p>
					)}
					{history && hasMeasurements && (
						<div className="mt-1 flex justify-between tabular-nums">
							<span>{timeLabel(history.start)}</span>
							<span>{timeLabel(history.end)}</span>
						</div>
					)}
					<p
						className="m-0 mt-1"
						title="Node root filesystem capacity. Claims may include remote storage and are not added to physical usage."
					>
						Stack: used + remaining. Line: claimed.
					</p>
					{error && (
						<p className="m-0 mt-1 text-content-warning">
							Updates unavailable. Showing the last readings.
						</p>
					)}
				</>
			)}
		</div>
	);
};
