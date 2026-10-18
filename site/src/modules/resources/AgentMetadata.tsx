import { cn } from "cn";
import dayjs from "dayjs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { watchAgentMetadata } from "#/api/api";
import type {
	ServerSentEvent,
	WorkspaceAgent,
	WorkspaceAgentMetadata,
} from "#/api/typesGenerated";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import {
	isNetworkMetadata,
	publishAgentMetadata,
} from "#/modules/platform/networkLeds/agentMetadataStore";
import type { OneWayWebSocket } from "#/utils/OneWayWebSocket";
import {
	levelColor,
	MetadataHistogram,
	metadataNumber,
	oneDecimal,
	shareOf,
	splitPercent,
	useMetadataHistory,
} from "./MetadataHistogram";
import {
	type GraphEvery,
	publishIntervals,
	useGraphEvery,
} from "./metricGraphSettings";

/** A metric the graphs can draw: its value holds a number. */
const shareOrNumber = (m: WorkspaceAgentMetadata) =>
	metadataNumber(m.result.value) !== null;

type ItemStatus = "stale" | "valid" | "loading";

type AgentMetadataViewProps = {
	metadata: WorkspaceAgentMetadata[];
	/** Whose readings the graphs keep (the agent's ID); one page can show several agents. */
	historyScope?: string;
	/** Stopped at (ms): the graphs stay as they were then, not advancing. */
	pausedAt?: number;
};

export const AgentMetadataView: React.FC<AgentMetadataViewProps> = ({
	metadata,
	historyScope = "",
	pausedAt,
}) => {
	const every = useGraphEvery();
	const historyOf = useMetadataHistory(historyScope, metadata, every !== "off");
	// for the agent's Metrics Interval menu (beside Open ports): how often each metric is reported
	const intervals = JSON.stringify(
		metadata
			.filter((m) => m.description.interval > 0 && shareOrNumber(m))
			.map((m) => ({
				name: `${isHostMetric(m) ? "Cluster" : "Workspace"} ${metricName(m)}`,
				s: m.description.interval,
			})),
	);
	useEffect(() => {
		if (historyScope) {
			publishIntervals(historyScope, JSON.parse(intervals));
		}
	}, [historyScope, intervals]);
	// 1 s and 5 s graphs advance on their own between the agent's readings
	const [, tick] = useState(0);
	useEffect(() => {
		if (
			typeof every !== "number" ||
			every <= 0 ||
			every >= 10 ||
			pausedAt !== undefined
		) {
			return;
		}
		const id = window.setInterval(() => tick((n) => n + 1), every * 1000);
		return () => window.clearInterval(id);
	}, [every, pausedAt]);
	if (metadata.length === 0) {
		return null;
	}
	const groups = groupMetadata(metadata);
	const item = (m: WorkspaceAgentMetadata) => (
		<MetadataItem
			key={m.description.key}
			item={m}
			history={historyOf(m.description.key)}
			every={every}
			pausedAt={pausedAt}
		/>
	);
	// Platform: the workspace's own metrics and the cluster's (the node it runs on), each in its own squircle
	if (groups.length === 1 && groups[0].id === "other") {
		return (
			<section
				className="flex items-baseline flex-wrap gap-8 gap-y-4"
				data-metrics
			>
				{metadata.map(item)}
			</section>
		);
	}
	return (
		<section
			className="flex min-w-0 flex-nowrap items-stretch gap-3 overflow-x-auto pb-1"
			data-metrics
		>
			{groups.map((g) => (
				<div
					key={g.id}
					role="group"
					aria-label={g.title}
					title={g.hint}
					className="flex min-w-fit flex-1 flex-col gap-2 rounded-2xl border border-solid border-border bg-surface-secondary/40 px-3.5 pt-3 pb-4"
					data-testid={`metrics-group-${g.id}`}
				>
					<div className="text-center text-xs font-semibold uppercase tracking-wide text-content-secondary">
						{g.title}
					</div>
					{/* Platform: the group fills its share of the row; its metrics spread across it, each a little wider */}
					<div className="flex items-baseline flex-nowrap justify-evenly gap-4">
						{g.items.map(item)}
					</div>
				</div>
			))}
		</section>
	);
};

/**
 * "CPU Usage (Host)" → "CPU Usage": the Cluster group says it (templates from before the grouping); a load average
 * ("Load Avg", "Load Average") is "Ø Load", as the template names it now.
 */
export const metricName = (m: WorkspaceAgentMetadata) => {
	const name = m.description.display_name.replace(
		/\s*\((host|cluster)\)\s*$/i,
		"",
	);
	return /^load(\s+av(g|erage)\.?)?$/i.test(name) ? "Ø Load" : name;
};

/** The order of the metrics in both groups: CPU, RAM, Disk, Ø Load, then anything else as the template has it. */
const METRIC_ORDER = [/cpu/i, /ram|mem/i, /disk/i, /load/i] as const;
export const metricRank = (m: WorkspaceAgentMetadata) => {
	const text = `${m.description.key} ${m.description.display_name}`;
	const i = METRIC_ORDER.findIndex((re) => re.test(text));
	return i === -1 ? METRIC_ORDER.length : i;
};
const inMetricOrder = (items: readonly WorkspaceAgentMetadata[]) =>
	[...items].sort((a, b) => metricRank(a) - metricRank(b)); // stable: the rest keep the template's order

const isHostMetric = (m: WorkspaceAgentMetadata) =>
	/_host$/i.test(m.description.key) ||
	/\((host|cluster)\)\s*$/i.test(m.description.display_name);

type MetricGroup = {
	id: "workspace" | "cluster" | "other";
	title: string;
	hint: string;
	items: WorkspaceAgentMetadata[];
};

/**
 * The agent's metrics in two groups: Cluster (the host's: keys ending in
 * "_host", or names ending "(Host)") and Workspace (the rest), each in the
 * same order: CPU, RAM, Disk, Ø Load. A template with no host metrics keeps
 * the plain row.
 */
const groupMetadata = (
	metadata: readonly WorkspaceAgentMetadata[],
): MetricGroup[] => {
	const cluster = metadata.filter(isHostMetric);
	const workspace = metadata.filter((m) => !isHostMetric(m));
	if (cluster.length === 0) {
		return [{ id: "other", title: "", hint: "", items: [...metadata] }];
	}
	return [
		...(workspace.length
			? [
					{
						id: "workspace" as const,
						title: "Workspace",
						hint: "This workspace: its own CPU, memory, disk and load",
						items: inMetricOrder(workspace),
					},
				]
			: []),
		{
			id: "cluster" as const,
			title: "Cluster",
			hint: "The cluster node this workspace runs on",
			items: inMetricOrder(cluster),
		},
	];
};

type AgentMetadataProps = {
	agent: WorkspaceAgent;
	initialMetadata?: WorkspaceAgentMetadata[];
	/** Platform: stopped at (ms) - no contact with the workspace: the graphs stay as they were then. */
	pausedAt?: number;
};

// Platform: the longest wait between attempts to watch the metadata again (ms)
const maxRetryDelayMs = 30_000;

export const AgentMetadata: React.FC<AgentMetadataProps> = ({
	agent,
	initialMetadata,
	pausedAt,
}) => {
	const [activeMetadata, setActiveMetadata] = useState(initialMetadata);
	useEffect(() => {
		// This is an unfortunate pitfall with this component's testing setup,
		// but even though we use the value of initialMetadata as the initial
		// value of the activeMetadata, we cannot put activeMetadata itself into
		// the dependency array. If we did, we would destroy and rebuild each
		// connection every single time a new message comes in from the socket,
		// because the socket has to be wired up to the state setter
		if (initialMetadata !== undefined) {
			return;
		}

		let timeoutId: number | undefined;
		let activeSocket: OneWayWebSocket<ServerSentEvent> | null = null;
		let retries = 0;

		const createNewConnection = () => {
			const socket = watchAgentMetadata(agent.id);
			activeSocket = socket;

			socket.addEventListener("error", () => {
				// Platform: the last readings stay (the card greys them while there is no contact with Coder, and the
				// page says so) and it keeps trying, a little less often each time - it comes back with Coder.
				window.clearTimeout(timeoutId);
				socket.close();
				activeSocket = null;
				retries++;
				timeoutId = window.setTimeout(
					createNewConnection,
					Math.min(maxRetryDelayMs, 3_000 * retries),
				);
			});

			socket.addEventListener("message", (e) => {
				if (e.parseError) {
					toast.error("Unable to process newest response from server.", {
						description: "Please try refreshing the page.",
					});
					return;
				}

				const msg = e.parsedMessage;
				retries = 0;
				if (msg.type === "data") {
					setActiveMetadata(msg.data as WorkspaceAgentMetadata[]);
				}
			});
		};

		createNewConnection();
		return () => {
			window.clearTimeout(timeoutId);
			activeSocket?.close();
		};
	}, [agent.id, initialMetadata]);

	// Platform: every update for the rest of the page (the network lights in the agent's header), and the network
	// reading kept out of the metric displays
	useEffect(() => {
		if (activeMetadata) {
			publishAgentMetadata(agent.id, activeMetadata);
		}
	}, [agent.id, activeMetadata]);
	const shown = useMemo(
		() => activeMetadata?.filter((m) => !isNetworkMetadata(m)),
		[activeMetadata],
	);

	if (shown === undefined) {
		return (
			<section className="flex items-baseline flex-wrap gap-8 gap-y-4">
				<AgentMetadataSkeleton />
			</section>
		);
	}

	return (
		<AgentMetadataView
			metadata={shown}
			historyScope={agent.id}
			pausedAt={pausedAt}
		/>
	);
};

const AgentMetadataSkeleton: React.FC = () => {
	return (
		<div className="flex flex-row items-baseline gap-12">
			<div className="leading-relaxed flex flex-col overflow-visible shrink-0">
				<Skeleton width={40} height={6} variant="text" />
				<Skeleton width={65} height={8} variant="text" />
			</div>

			<div className="leading-relaxed flex flex-col overflow-visible shrink-0">
				<Skeleton width={40} height={6} variant="text" />
				<Skeleton width={65} height={8} variant="text" />
			</div>

			<div className="leading-relaxed flex flex-col overflow-visible shrink-0">
				<Skeleton width={40} height={6} variant="text" />
				<Skeleton width={65} height={8} variant="text" />
			</div>
		</div>
	);
};

type MetadataItemProps = {
	item: WorkspaceAgentMetadata;
	/** Its readings so far, for the live graph above the value. */
	history: React.ComponentProps<typeof MetadataHistogram>["samples"];
	/** Seconds per bar (0: one per reading); "off": no graph. */
	every: GraphEvery;
	/** Stopped at (ms): its graph stays as it was then. */
	pausedAt?: number;
};

const MetadataItem: React.FC<MetadataItemProps> = ({
	item,
	history,
	every,
	pausedAt,
}) => {
	const staleThreshold = Math.max(
		item.description.interval + item.description.timeout * 2,
		// In case there is intense backpressure, we give a little bit of slack.
		5,
	);

	const status: ItemStatus = (() => {
		const year = dayjs(item.result.collected_at).year();
		if (year <= 1970 || Number.isNaN(year)) {
			return "loading";
		}
		// There is a special circumstance for metadata with `interval: 0`. It is
		// expected that they run once and never again, so never display them as
		// stale.
		if (item.result.age > staleThreshold && item.description.interval > 0) {
			return "stale";
		}
		return "valid";
	})();

	// Platform: the percentage goes in a chip by the name, the rest stays below the graph
	const reading = splitPercent(oneDecimal(item.result.value));
	const percent =
		status === "loading" || item.result.error.length > 0
			? null
			: reading.percent;

	// Stale data is as good as no data. Plus, we want to build confidence in our
	// users that what's shown is real. If times aren't correctly synced this
	// could be buggy. But, how common is that anyways?
	const value =
		status === "loading" ? (
			<Skeleton width={65} height={12} variant="text" className="mt-[6px]" />
		) : status === "stale" ? (
			<Tooltip>
				<TooltipTrigger asChild>
					<StaticWidth className="text-ellipsis overflow-hidden whitespace-nowrap max-w-full text-[13px] text-content-disabled cursor-pointer">
						{reading.text}
					</StaticWidth>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					This data is stale and no longer up to date
				</TooltipContent>
			</Tooltip>
		) : (
			// Platform: never wider than its column (StaticWidth only grows): a long reading - a script's error - is cut
			// short, whole on hover, instead of widening its group and pushing the next one aside for good
			<StaticWidth
				className={cn(
					"text-ellipsis overflow-hidden whitespace-nowrap max-w-full text-[13px] text-content-success",
					item.result.error.length > 0 && "text-content-destructive",
				)}
				title={reading.text}
			>
				{reading.text}
			</StaticWidth>
		);

	return (
		<div className="leading-relaxed flex min-w-[104px] max-w-[136px] flex-1 flex-col overflow-visible">
			<div className="flex items-center justify-between gap-3">
				<div className="text-content-secondary text-ellipsis overflow-hidden whitespace-nowrap text-[13px]">
					{metricName(item)}
				</div>
				{percent !== null && (
					<PercentChip percent={percent} stale={status === "stale"} />
				)}
			</div>
			{/* Platform: the readings so far, as a live bar graph above the value */}
			{every !== "off" && history.length > 0 && (
				<MetadataHistogram
					samples={history}
					share={shareOf(item)}
					every={every}
					hold={
						every > 0 && every < item.description.interval
							? item.description.interval * 1.5 + item.description.timeout
							: 0
					}
					stale={status === "stale"}
					label={metricName(item)}
					pausedAt={pausedAt}
				/>
			)}
			<div>{value}</div>
		</div>
	);
};

/** The reading's percentage, tinted like its graph (levelColor). */
const PercentChip: React.FC<{ percent: number; stale: boolean }> = ({
	percent,
	stale,
}) => {
	const color = levelColor(percent);
	return (
		<span
			className={cn(
				"shrink-0 rounded-md border border-solid px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums",
				stale && "border-border text-content-disabled",
			)}
			style={
				stale
					? undefined
					: {
							color,
							borderColor: `${color}66`,
							backgroundColor: `${color}1a`,
						}
			}
			data-testid="metadata-percent"
		>
			{Math.round(percent)}%
		</span>
	);
};

const StaticWidth: React.FC<Omit<React.ComponentProps<"div">, "ref">> = ({
	children,
	...attrs
}) => {
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		// Ignore this in storybook
		if (!ref.current || process.env.STORYBOOK === "true") {
			return;
		}

		const currentWidth = ref.current.getBoundingClientRect().width;
		ref.current.style.width = "auto";
		const autoWidth = ref.current.getBoundingClientRect().width;
		ref.current.style.width =
			autoWidth > currentWidth ? `${autoWidth}px` : `${currentWidth}px`;
	}, [children]);

	return (
		<div ref={ref} {...attrs}>
			{children}
		</div>
	);
};
