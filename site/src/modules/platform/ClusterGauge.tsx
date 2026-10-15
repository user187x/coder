import { cn } from "cn";
import { useQuery } from "react-query";
import type { ClusterNetwork, ResourceUsage } from "#/api/platform";
import { clusterUsage } from "#/api/queries/platform";

const GiB = 1024 ** 3;

const trimNumber = (value: number): string => {
	if (!Number.isFinite(value)) {
		return "0";
	}
	const fixed =
		value >= 100
			? value.toFixed(0)
			: value >= 10
				? value.toFixed(1)
				: value.toFixed(2);
	return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

type Kind = "cpu" | "memory";

const amount = (kind: Kind, value: number) =>
	trimNumber(kind === "cpu" ? value : value / GiB);

const unit = (kind: Kind, value: number) => {
	if (kind === "memory") {
		return "GiB";
	}
	return Math.abs(value - 1) < 0.005 ? "core" : "cores";
};

const formatAmount = (kind: Kind, value: number) =>
	`${amount(kind, value)} ${unit(kind, value)}`;

/**
 * The last entry of the Settings menu: the cluster's CPU and memory at a glance,
 * refreshed while the menu is open. Each bar fills with what is in use (live
 * from metrics-server; without it, what pods requested), the band behind it
 * is what running pods reserved, and "free" is what new workspaces can still
 * be given; under both, the network graph. Users who are not admins get no
 * answer, so nothing is shown.
 */
export const ClusterGauge: React.FC = () => {
	const { data } = useQuery(clusterUsage());

	if (!data) {
		return null;
	}

	return (
		<div
			role="group"
			aria-label="Cluster CPU, memory and network"
			data-cluster-gauge=""
			className="mt-1 px-2.5 pt-2.5 pb-1.5 border-0 border-t border-solid border-border cursor-default"
		>
			<div className="flex items-baseline justify-between mb-2 text-xs font-semibold text-content-primary">
				<span>Cluster</span>
				<span
					className="text-2xs font-normal text-content-secondary flex items-center gap-1.5"
					title={
						data.live
							? "In use = live usage (metrics-server)"
							: "metrics-server is not installed: in use = what pods requested"
					}
				>
					{data.live && (
						<span
							aria-hidden
							className="size-1.5 rounded-full bg-content-success animate-pulse motion-reduce:animate-none"
						/>
					)}
					{data.live ? "live" : "requests"} · {data.nodes}{" "}
					{data.nodes === 1 ? "node" : "nodes"}
				</span>
			</div>
			<div className="grid grid-cols-2 gap-3.5">
				<UsageBar kind="cpu" label="CPU" usage={data.cpu} />
				<UsageBar kind="memory" label="Memory" usage={data.memory} />
			</div>
			{data.network && data.network.points.length > 0 && (
				<NetworkGraph network={data.network} />
			)}
		</div>
	);
};

/** Bytes per second, as the workspace's network lights show them: B/s to GB/s. */
export const formatRate = (bytesPerSecond: number): string => {
	const units = ["B/s", "kB/s", "MB/s", "GB/s"];
	let value = Math.max(0, bytesPerSecond);
	let i = 0;
	while (value >= 1000 && i < units.length - 1) {
		value /= 1000;
		i++;
	}
	return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

/** The graph's slots: 15 minutes of rounds (60 at the HUD's 15 seconds). */
const NETWORK_SLOTS = 60;

/**
 * Under the CPU and memory bars, as wide as both: the cluster's network
 * traffic over the last 15 minutes, a bar a round (the HUD's samples): what
 * the nodes received rising above the line in green, what they sent hanging
 * below it in blue, both to the same scale (the window's peak). Newest at the
 * right; each bar's time and rates on hover.
 */
const NetworkGraph: React.FC<{ network: ClusterNetwork }> = ({ network }) => {
	const points = network.points.slice(-NETWORK_SLOTS);
	const peak = Math.max(1, ...points.flatMap((p) => [p.rx, p.tx]));
	const slot = 100 / NETWORK_SLOTS;
	const half = 20;
	const minutes = Math.round((NETWORK_SLOTS * network.every) / 60);

	return (
		<div
			className="mt-3 min-w-0 text-2xs text-content-secondary"
			data-testid="cluster-network"
		>
			<div className="mb-1 flex justify-between font-semibold text-content-primary">
				<span>Network</span>
				<span className="flex gap-2 font-normal tabular-nums">
					<span className="text-content-success" title="Received by the nodes">
						↓ {formatRate(network.rx)}
					</span>
					<span className="text-content-link" title="Sent by the nodes">
						↑ {formatRate(network.tx)}
					</span>
				</span>
			</div>
			<svg
				role="img"
				aria-label={`Cluster network over the last ${minutes} minutes: now ${formatRate(network.rx)} received, ${formatRate(network.tx)} sent`}
				viewBox={`0 0 100 ${half * 2}`}
				preserveAspectRatio="none"
				className="block h-10 w-full overflow-hidden rounded bg-surface-tertiary"
			>
				<line
					x1={0}
					x2={100}
					y1={half}
					y2={half}
					className="stroke-border"
					strokeWidth={0.4}
					vectorEffect="non-scaling-stroke"
				/>
				{points.map((p, i) => {
					const x = (NETWORK_SLOTS - points.length + i) * slot;
					const up = (p.rx / peak) * (half - 1);
					const down = (p.tx / peak) * (half - 1);
					return (
						<g key={p.t}>
							<title>
								{`${new Date(p.t * 1000).toLocaleTimeString("en-US")} · ↓ ${formatRate(p.rx)} · ↑ ${formatRate(p.tx)}`}
							</title>
							<rect
								x={x + slot * 0.15}
								width={slot * 0.7}
								y={half - up}
								height={up}
								className="fill-content-success"
							/>
							<rect
								x={x + slot * 0.15}
								width={slot * 0.7}
								y={half}
								height={down}
								className="fill-content-link"
							/>
						</g>
					);
				})}
			</svg>
			<div className="mt-1 flex justify-between tabular-nums">
				<span>{minutes} min ago</span>
				<span>peak {formatRate(peak)}</span>
				<span>now</span>
			</div>
		</div>
	);
};

type UsageBarProps = {
	kind: Kind;
	label: string;
	usage: ResourceUsage;
};

const UsageBar: React.FC<UsageBarProps> = ({ kind, label, usage }) => {
	const percentOf = (value: number) =>
		usage.total > 0 ? Math.min(100, (value / usage.total) * 100) : 0;
	const used = percentOf(usage.used);
	const level = used >= 90 ? "high" : used >= 70 ? "mid" : "low";

	return (
		<div
			className="min-w-0 text-2xs text-content-secondary"
			title={`In use ${formatAmount(kind, usage.used)} · reserved by pods ${formatAmount(kind, usage.requested)} · allocatable ${formatAmount(kind, usage.total)}`}
		>
			<div className="flex justify-between mb-1 font-semibold text-content-primary">
				<span>{label}</span>
				<span>{Math.round(used)}%</span>
			</div>
			<div
				role="meter"
				aria-label={`${label} in use`}
				aria-valuemin={0}
				aria-valuemax={usage.total}
				aria-valuenow={usage.used}
				aria-valuetext={`${formatAmount(kind, usage.used)} of ${formatAmount(kind, usage.total)}`}
				className="relative h-2 rounded overflow-hidden bg-surface-tertiary"
			>
				<div
					className="absolute inset-y-0 left-0 rounded bg-content-secondary/25 transition-[width] duration-500 motion-reduce:transition-none"
					style={{ width: `${percentOf(usage.requested)}%` }}
				/>
				<div
					className={cn(
						"absolute inset-y-0 left-0 rounded transition-[width] duration-500 motion-reduce:transition-none",
						level === "high"
							? "bg-content-destructive"
							: level === "mid"
								? "bg-content-warning"
								: "bg-content-success",
					)}
					style={{ width: `${used}%` }}
				/>
			</div>
			<div className="mt-1 tabular-nums text-content-primary truncate">
				{amount(kind, usage.used)} / {amount(kind, usage.total)}{" "}
				{unit(kind, usage.total)}
			</div>
			<div className="tabular-nums">{formatAmount(kind, usage.free)} free</div>
		</div>
	);
};
