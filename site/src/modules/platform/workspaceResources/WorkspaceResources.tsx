import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { watchAgentMetadata } from "#/api/api";
import type {
	ServerSentEvent,
	Workspace,
	WorkspaceAgentMetadata,
} from "#/api/typesGenerated";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import {
	isCloudDriveMetadata,
	isNetworkMetadata,
} from "#/modules/platform/networkLeds/agentMetadataStore";
import { isHostMetric, metricRank } from "#/modules/resources/AgentMetadata";
import {
	levelColor,
	oneDecimal,
	splitPercent,
} from "#/modules/resources/MetadataHistogram";
import type { OneWayWebSocket } from "#/utils/OneWayWebSocket";

/** How many readings the CPU and RAM graphs show, the newest on the right. */
export const GRAPH_BARS = 12;
/** The disk's bar, in segments. */
export const DISK_SEGMENTS = 16;
const GRAPH_W = 52;
const GRAPH_H = 22;
// the longest wait between attempts to watch the readings again (ms)
const MAX_RETRY_MS = 30_000;

type Reading = { share: number; text: string };

/**
 * A metric's share of what there is (0-100) and its text, from a reading such as "0.1/2 cores (6%)": its
 * percentage, else the fraction it states ("0.1/10.0 GB" -> 1). None for an error or a reading without either.
 */
export const readingOf = (m?: WorkspaceAgentMetadata): Reading | null => {
	if (!m || m.result.error || !m.result.value) {
		return null;
	}
	const { text, percent } = splitPercent(oneDecimal(m.result.value.trim()));
	let share = percent;
	if (share === null) {
		const f = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
		if (f && Number(f[2]) > 0) {
			share = (Number(f[1]) / Number(f[2])) * 100;
		}
	}
	return share === null
		? null
		: { share: Math.max(0, Math.min(100, share)), text };
};

/** The workspace's own CPU, RAM and disk readings (not the cluster's), as its page shows them. */
const RANKS = { cpu: 0, ram: 1, disk: 2 } as const;
const workspaceMetric = (
	metadata: readonly WorkspaceAgentMetadata[],
	rank: number,
) =>
	metadata.find(
		(m) =>
			!isHostMetric(m) &&
			!isNetworkMetadata(m) &&
			!isCloudDriveMetadata(m) &&
			metricRank(m) === rank,
	);

/**
 * An agent's metadata, live (its page's socket), and the CPU and RAM shares of its last GRAPH_BARS readings. It
 * keeps trying, less often each time, while the socket fails.
 */
const useAgentReadings = (agentId: string | undefined) => {
	const [metadata, setMetadata] = useState<WorkspaceAgentMetadata[]>();
	const [series, setSeries] = useState<{ cpu: number[]; ram: number[] }>({
		cpu: [],
		ram: [],
	});
	const seen = useRef<{ cpu?: string; ram?: string }>({});

	useEffect(() => {
		setMetadata(undefined);
		setSeries({ cpu: [], ram: [] });
		seen.current = {};
		if (!agentId) {
			return;
		}
		let socket: OneWayWebSocket<ServerSentEvent> | null = null;
		let timer: number | undefined;
		let retries = 0;
		let closed = false;
		const connect = () => {
			const s = watchAgentMetadata(agentId);
			socket = s;
			s.addEventListener("message", (e) => {
				if (e.parseError || e.parsedMessage.type !== "data") {
					return;
				}
				retries = 0;
				const data = e.parsedMessage.data as WorkspaceAgentMetadata[];
				setMetadata(data);
				// a new reading (a new collected_at) adds a bar
				const next: { cpu?: number; ram?: number } = {};
				for (const key of ["cpu", "ram"] as const) {
					const m = workspaceMetric(data, RANKS[key]);
					const reading = readingOf(m);
					if (m && reading && seen.current[key] !== m.result.collected_at) {
						seen.current[key] = m.result.collected_at;
						next[key] = reading.share;
					}
				}
				if (next.cpu !== undefined || next.ram !== undefined) {
					setSeries((prev) => ({
						cpu:
							next.cpu === undefined
								? prev.cpu
								: [...prev.cpu, next.cpu].slice(-GRAPH_BARS),
						ram:
							next.ram === undefined
								? prev.ram
								: [...prev.ram, next.ram].slice(-GRAPH_BARS),
					}));
				}
			});
			s.addEventListener("error", () => {
				s.close();
				socket = null;
				if (closed) {
					return;
				}
				retries++;
				timer = window.setTimeout(
					connect,
					Math.min(MAX_RETRY_MS, 3_000 * retries),
				);
			});
		};
		connect();
		return () => {
			closed = true;
			window.clearTimeout(timer);
			socket?.close();
		};
	}, [agentId]);

	return { metadata, series };
};

/**
 * Platform: the Workspaces table's Resources column - a running workspace's CPU and RAM as small live bar graphs
 * (its last readings, each bar coloured by its level, as on its page) and its disk as a bar of what is used of what
 * it was given. The readings are its agent's metadata, the same as its page's Workspace group; a workspace that is
 * not running (or whose agent is not connected) shows a dash.
 */
export const WorkspaceResources: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const agent =
		workspace.latest_build.status === "running"
			? workspace.latest_build.resources
					.flatMap((r) => r.agents ?? [])
					.find((a) => a.parent_id === null && a.status === "connected")
			: undefined;
	const { metadata, series } = useAgentReadings(agent?.id);

	if (!agent) {
		return (
			<div className="text-center">
				<span
					data-testid="workspace-resources-none"
					className="text-xs text-content-disabled"
				>
					—
				</span>
			</div>
		);
	}
	if (!metadata) {
		return (
			<div className="flex items-center justify-center gap-3" aria-busy>
				<Skeleton className="h-[38px] w-[52px] rounded-md" />
				<Skeleton className="h-[38px] w-[52px] rounded-md" />
				<Skeleton className="h-[38px] w-28 rounded-md" />
			</div>
		);
	}
	const cpu = readingOf(workspaceMetric(metadata, RANKS.cpu));
	const ram = readingOf(workspaceMetric(metadata, RANKS.ram));
	const disk = readingOf(workspaceMetric(metadata, RANKS.disk));
	return (
		<div
			data-testid="workspace-resources"
			className="flex items-center justify-center gap-3"
			// the row opens the workspace; the readings are only to look at
		>
			<BarGraph label="CPU" reading={cpu} shares={series.cpu} />
			<BarGraph label="RAM" reading={ram} shares={series.ram} />
			<DiskBar reading={disk} />
		</div>
	);
};

const Percent: React.FC<{ share: number | null }> = ({ share }) => (
	<span
		className="tabular-nums font-semibold"
		style={share === null ? undefined : { color: levelColor(share) }}
	>
		{share === null ? "–" : `${Math.round(share)}%`}
	</span>
);

/** A metric's last readings as vertical bars, the newest on the right, under its name and its share now. */
const BarGraph: React.FC<{
	label: string;
	reading: Reading | null;
	shares: readonly number[];
}> = ({ label, reading, shares }) => {
	const bar = GRAPH_W / GRAPH_BARS;
	const shown = shares.length ? shares : reading ? [reading.share] : [];
	return (
		<div
			data-testid={`workspace-resources-${label.toLowerCase()}`}
			title={reading ? `${label}: ${reading.text}` : `${label}: no reading`}
			className="flex flex-col gap-1"
			style={{ width: GRAPH_W }}
		>
			<div className="flex items-baseline justify-between gap-1.5 text-[11px] leading-none">
				<span className="text-content-secondary">{label}</span>
				<Percent share={reading?.share ?? null} />
			</div>
			<svg
				aria-hidden
				width={GRAPH_W}
				height={GRAPH_H}
				viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
				className="block overflow-visible"
			>
				{/* the graph's ground, faint, so it reads as one even while the bars are low */}
				<rect
					x={0}
					y={0}
					width={GRAPH_W}
					height={GRAPH_H}
					rx={3}
					className="fill-surface-secondary"
				/>
				<line
					x1={0}
					x2={GRAPH_W}
					y1={GRAPH_H - 0.5}
					y2={GRAPH_H - 0.5}
					className="stroke-border"
					strokeWidth={1}
				/>
				{shown.map((share, i) => {
					const h = Math.max(1.5, (share / 100) * GRAPH_H);
					const x = GRAPH_W - (shown.length - i) * bar;
					return (
						<rect
							key={i}
							data-testid="workspace-resources-bar"
							x={x + 0.5}
							y={GRAPH_H - h}
							width={Math.max(1, bar - 1.5)}
							height={h}
							rx={0.75}
							fill={levelColor(share)}
						/>
					);
				})}
			</svg>
		</div>
	);
};

/**
 * The theme's colour of a disk segment by where it sits along the bar: success up to 70 %, warning to 90 %,
 * destructive beyond.
 */
export const segmentTone = (position: number) =>
	position > 90
		? "bg-content-destructive"
		: position > 70
			? "bg-content-warning"
			: "bg-content-success";

/**
 * The disk: what is used of what the workspace was given, as a bar of DISK_SEGMENTS segments - as many lit as the
 * share used (one at least, when anything is), each in the theme's colour for where it sits, the rest the theme's
 * empty surface - with the two figures below it.
 */
const DiskBar: React.FC<{ reading: Reading | null }> = ({ reading }) => {
	const text = reading?.text.replace(/\s*\/\s*/, " / ");
	const lit = reading
		? Math.min(
				DISK_SEGMENTS,
				Math.max(
					reading.share > 0 ? 1 : 0,
					Math.round((reading.share / 100) * DISK_SEGMENTS),
				),
			)
		: 0;
	return (
		<div
			data-testid="workspace-resources-disk"
			title={reading ? `Disk: ${text} (used / allocated)` : "Disk: no reading"}
			className="flex w-28 flex-col gap-1"
		>
			<div className="flex items-baseline justify-between gap-1.5 text-[11px] leading-none">
				<span className="text-content-secondary">Disk</span>
				<Percent share={reading?.share ?? null} />
			</div>
			<div
				role="meter"
				aria-label="Disk used of allocated"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={reading ? Math.round(reading.share) : undefined}
				className="flex h-2 w-full gap-[2px]"
			>
				{Array.from({ length: DISK_SEGMENTS }, (_, i) => (
					<span
						// a segment is its place along the bar
						key={i}
						data-testid="workspace-resources-segment"
						data-lit={i < lit || undefined}
						className={cn(
							"h-full flex-1 rounded-[1.5px]",
							i < lit
								? segmentTone(((i + 1) / DISK_SEGMENTS) * 100)
								: "bg-surface-tertiary",
						)}
					/>
				))}
			</div>
			<span className="truncate text-[11px] leading-none tabular-nums text-content-secondary">
				{text ?? "–"}
			</span>
		</div>
	);
};
