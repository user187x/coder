import { cn } from "cn";
import dayjs from "dayjs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import type { OneWayWebSocket } from "#/utils/OneWayWebSocket";
import {
	MetadataHistogram,
	metadataNumber,
	shareOf,
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
};

export const AgentMetadataView: React.FC<AgentMetadataViewProps> = ({
	metadata,
	historyScope = "",
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
		if (typeof every !== "number" || every <= 0 || every >= 10) {
			return;
		}
		const id = window.setInterval(() => tick((n) => n + 1), every * 1000);
		return () => window.clearInterval(id);
	}, [every]);
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
		/>
	);
	// Platform: the workspace's own metrics and the cluster's (the node it runs on), each in its own squircle
	if (groups.length === 1 && groups[0].id === "other") {
		return (
			<section className="flex items-baseline flex-wrap gap-8 gap-y-4">
				{metadata.map(item)}
			</section>
		);
	}
	return (
		<section className="flex flex-nowrap items-stretch gap-4 overflow-x-auto pb-1">
			{groups.map((g) => (
				<div
					key={g.id}
					role="group"
					aria-label={g.title}
					title={g.hint}
					className="flex shrink-0 flex-col gap-2 rounded-2xl border border-solid border-border bg-surface-secondary/40 px-4 pt-3 pb-4"
					data-testid={`metrics-group-${g.id}`}
				>
					<div className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
						{g.title}
					</div>
					<div className="flex items-baseline flex-nowrap gap-5">
						{g.items.map(item)}
					</div>
				</div>
			))}
		</section>
	);
};

/** "CPU Usage (Host)" → "CPU Usage": the Cluster group says it (templates from before the grouping). */
const metricName = (m: WorkspaceAgentMetadata) =>
	m.description.display_name.replace(/\s*\((host|cluster)\)\s*$/i, "");

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
 * "_host", or names ending "(Host)") and Workspace (the rest). A template with
 * no host metrics keeps the plain row.
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
						hint: "This workspace: its own CPU, memory and disk",
						items: workspace,
					},
				]
			: []),
		{
			id: "cluster" as const,
			title: "Cluster",
			hint: "The cluster node this workspace runs on",
			items: cluster,
		},
	];
};

type AgentMetadataProps = {
	agent: WorkspaceAgent;
	initialMetadata?: WorkspaceAgentMetadata[];
};

const maxSocketErrorRetryCount = 3;

export const AgentMetadata: React.FC<AgentMetadataProps> = ({
	agent,
	initialMetadata,
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
				setActiveMetadata(undefined);
				window.clearTimeout(timeoutId);

				// The error event is supposed to fire when an error happens
				// with the connection itself, which implies that the connection
				// would auto-close. Couldn't find a definitive answer on MDN,
				// though, so closing it manually just to be safe
				socket.close();
				activeSocket = null;

				retries++;
				if (retries >= maxSocketErrorRetryCount) {
					toast.error(
						"Unexpected disconnect while watching Metadata changes.",
						{
							description: "Please try refreshing the page.",
						},
					);
					return;
				}

				toast.error("Unexpected disconnect while watching Metadata changes.", {
					description: "Creating new connection...",
				});
				timeoutId = window.setTimeout(() => {
					createNewConnection();
				}, 3_000);
			});

			socket.addEventListener("message", (e) => {
				if (e.parseError) {
					toast.error("Unable to process newest response from server.", {
						description: "Please try refreshing the page.",
					});
					return;
				}

				const msg = e.parsedMessage;
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

	if (activeMetadata === undefined) {
		return (
			<section className="flex items-baseline flex-wrap gap-8 gap-y-4">
				<AgentMetadataSkeleton />
			</section>
		);
	}

	return (
		<AgentMetadataView metadata={activeMetadata} historyScope={agent.id} />
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
};

const MetadataItem: React.FC<MetadataItemProps> = ({
	item,
	history,
	every,
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

	// Stale data is as good as no data. Plus, we want to build confidence in our
	// users that what's shown is real. If times aren't correctly synced this
	// could be buggy. But, how common is that anyways?
	const value =
		status === "loading" ? (
			<Skeleton width={65} height={12} variant="text" className="mt-[6px]" />
		) : status === "stale" ? (
			<Tooltip>
				<TooltipTrigger asChild>
					<StaticWidth className="text-ellipsis overflow-hidden whitespace-nowrap max-w-64 text-sm text-content-disabled cursor-pointer">
						{item.result.value}
					</StaticWidth>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					This data is stale and no longer up to date
				</TooltipContent>
			</Tooltip>
		) : (
			<StaticWidth
				className={cn(
					"text-ellipsis overflow-hidden whitespace-nowrap max-w-64 text-sm text-content-success",
					item.result.error.length > 0 && "text-content-destructive",
				)}
			>
				{item.result.value}
			</StaticWidth>
		);

	return (
		<div className="leading-relaxed flex flex-col overflow-visible shrink-0">
			<div className="text-content-secondary text-ellipsis overflow-hidden whitespace-nowrap text-[13px]">
				{metricName(item)}
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
				/>
			)}
			<div>{value}</div>
		</div>
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
