import { cn } from "cn";
import { useSyncExternalStore } from "react";

/** How long ago an ISO timestamp was, in the largest sensible unit ("N/A" if unknown). */
export const ago = (iso: string | null, now: number): string => {
	if (!iso) {
		return "N/A";
	}
	const s = Math.max(0, (now - Date.parse(iso)) / 1000);
	if (!Number.isFinite(s)) {
		return "N/A";
	}
	return s < 90
		? `${Math.round(s)} s`
		: s < 5400
			? `${Math.round(s / 60)} min`
			: s < 129_600
				? `${Math.round(s / 3600)} h`
				: `${Math.round(s / 86_400)} d`;
};

/** Bytes in binary units, e.g. "1.5 GiB" ("N/A" if unknown). */
export const bytes = (b: number | null | undefined) => {
	if (b == null || !Number.isFinite(b)) {
		return "N/A";
	}
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	let value = b;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i += 1;
	}
	return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

/** value as a share of total, capped at 100; null when either is unknown. */
const percent = (
	value: number | null | undefined,
	total: number | null | undefined,
) => (value != null && total ? Math.min(100, (value / total) * 100) : null);

// One clock for the "updated N s ago" labels and ages, ticking every second.
let clock = Date.now();
const subscribeToClock = (listener: () => void) => {
	const timer = window.setInterval(() => {
		clock = Date.now();
		listener();
	}, 1000);
	return () => window.clearInterval(timer);
};
export const useNow = () => useSyncExternalStore(subscribeToClock, () => clock);

/** "Live · updated N s ago" for views that re-read the cluster on an interval. */
export const LiveStatus: React.FC<{ paused: boolean; updatedAt: number }> = ({
	paused,
	updatedAt,
}) => {
	const now = useNow();
	const age = updatedAt ? Math.round((now - updatedAt) / 1000) : null;
	const stale = !paused && age !== null && age > 15;
	return (
		<span
			className="inline-flex items-center gap-2 text-sm tabular-nums text-content-secondary"
			data-pixel="ignore"
		>
			<span
				aria-hidden
				className={cn(
					"size-2 rounded-full",
					paused
						? "bg-content-secondary"
						: stale
							? "bg-content-warning"
							: "bg-content-success animate-pulse motion-reduce:animate-none",
				)}
			/>
			{paused
				? "Paused"
				: age === null
					? "Loading…"
					: `Live · updated ${age} s ago`}
		</span>
	);
};

/** One headline number with a label and an optional line under it. */
export const Tile: React.FC<{ label: string; value: string; sub?: string }> = ({
	label,
	value,
	sub,
}) => (
	<div className="min-w-0 rounded-lg border border-solid border-border px-3.5 py-3">
		<div className="text-xs font-medium text-content-secondary">{label}</div>
		<div
			className="truncate text-[22px] font-semibold leading-snug tabular-nums"
			title={value}
		>
			{value}
		</div>
		<div className="truncate text-xs text-content-secondary" title={sub}>
			{sub || " "}
		</div>
	</div>
);

type MeterProps = {
	label: string;
	value: number | null | undefined;
	total: number | null;
	format: (value: number | null | undefined) => string;
	/** Reserved amount, drawn as a tick on the bar (e.g. what pods request). */
	requested?: number;
	title?: string;
};

/** A usage bar that turns red at 90%. */
export const Meter: React.FC<MeterProps> = ({
	label,
	value,
	total,
	format,
	requested,
	title,
}) => {
	const used = percent(value, total);
	const reserved = requested === undefined ? null : percent(requested, total);
	const hot = used !== null && used >= 90;
	const text =
		used === null
			? requested === undefined
				? "N/A"
				: `${format(requested)} requested`
			: `${format(value)} / ${format(total)}${hot ? " · high" : ""}`;
	return (
		<div
			role="meter"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={used === null ? undefined : Math.round(used)}
			aria-valuetext={text}
			title={title ?? `${label}: ${format(value)} of ${format(total)}`}
			className="grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-2 text-xs"
		>
			<span>{label}</span>
			<span className="relative h-2 overflow-hidden rounded bg-surface-tertiary">
				{used !== null && (
					<span
						className={cn(
							"absolute inset-y-0 left-0 rounded",
							hot ? "bg-content-destructive" : "bg-content-link",
						)}
						style={{ width: `${used.toFixed(1)}%` }}
					/>
				)}
				{reserved !== null && value !== requested && (
					<span
						className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-content-primary opacity-55"
						style={{ left: `calc(${reserved.toFixed(1)}% - 1px)` }}
					/>
				)}
			</span>
			<span className="whitespace-nowrap text-content-secondary tabular-nums">
				{text}
			</span>
		</div>
	);
};

export const StatusDot: React.FC<{
	status: "ok" | "warn" | "error";
	children: React.ReactNode;
}> = ({ status, children }) => (
	<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
		<span
			aria-hidden
			className={cn(
				"size-2 rounded-full",
				status === "ok"
					? "bg-content-success"
					: status === "warn"
						? "bg-content-warning"
						: "bg-content-destructive",
			)}
		/>
		{children}
	</span>
);

export const LegendChip: React.FC<{ className: string; label: string }> = ({
	className,
	label,
}) => (
	<span className="inline-flex items-center gap-1.5">
		<i className={cn("h-3 w-[3px] rounded-sm", className)} />
		{label}
	</span>
);
