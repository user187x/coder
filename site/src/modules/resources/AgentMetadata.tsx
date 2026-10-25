import { useEffect, useMemo, useState } from "react";
import { useQuery } from "react-query";
import { toast } from "sonner";
import { watchAgentMetadata } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import { workspaceInfrastructureMetrics } from "#/api/queries/workspaceMetrics";
import type {
	ServerSentEvent,
	Workspace,
	WorkspaceAgent,
	WorkspaceAgentMetadata,
} from "#/api/typesGenerated";
import type { WorkspaceInfrastructureMetrics } from "#/api/workspaceMetrics";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import { Switch } from "#/components/Switch/Switch";
import {
	isCloudDriveMetadata,
	isNetworkMetadata,
	publishAgentMetadata,
} from "#/modules/platform/networkLeds/agentMetadataStore";
import type { OneWayWebSocket } from "#/utils/OneWayWebSocket";
import {
	type InfrastructureScope,
	infrastructureMaximum,
	infrastructureMetadata,
	workspaceMaximum,
} from "./infrastructureMetrics";
import { metadataNumber, useMetadataHistory } from "./MetadataHistogram";
import { MetadataItem } from "./MetadataItem";
import {
	groupMetadata,
	inMetricOrder,
	isHostMetric,
	metricName,
	metricRank,
} from "./metadataGroups";
import { publishIntervals, useGraphEvery } from "./metricGraphSettings";

export { isHostMetric, metricName, metricRank } from "./metadataGroups";

/** A metric the graphs can draw: its value holds a number. */
const shareOrNumber = (m: WorkspaceAgentMetadata) =>
	metadataNumber(m.result.value) !== null;

type AgentMetadataViewProps = {
	now?: number;
	metadata: WorkspaceAgentMetadata[];
	workspaceName?: string;
	infrastructure?: WorkspaceInfrastructureMetrics;
	infrastructureLoading?: boolean;
	infrastructureError?: unknown;
	scope?: InfrastructureScope;
	onScopeChange?: (scope: InfrastructureScope) => void;
	/** Whose readings the graphs keep (the agent's ID); one page can show several agents. */
	historyScope?: string;
	/** Stopped at (ms): the graphs stay as they were then, not advancing. */
	pausedAt?: number;
};

export const AgentMetadataView: React.FC<AgentMetadataViewProps> = ({
	metadata,
	now,
	workspaceName,
	infrastructure,
	infrastructureLoading = false,
	infrastructureError,
	scope = "node",
	onScopeChange,
	historyScope = "",
	pausedAt,
}) => {
	const every = useGraphEvery();
	const scoped = Boolean(workspaceName || infrastructure);
	const restricted = infrastructure?.infrastructureRestricted === true;
	const host = scoped
		? infrastructure?.[scope] && !restricted
			? infrastructureMetadata(
					infrastructure[scope],
					scope,
					infrastructure.nodeName,
					now,
				)
			: []
		: metadata.filter(isHostMetric);
	const shown = scoped
		? [...metadata.filter((m) => !isHostMetric(m)), ...host]
		: metadata;
	const historyOf = useMetadataHistory(historyScope, shown, every !== "off");
	// for the agent's Metrics Interval menu (beside Open ports): how often each metric is reported
	const intervals = JSON.stringify(
		shown
			.filter((m) => m.description.interval > 0 && shareOrNumber(m))
			.map((m) => ({
				name: `${isHostMetric(m) ? (scope === "node" ? "Node" : "Cluster") : "Workspace"} ${metricName(m)}`,
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
	if (metadata.length === 0 && !scoped) {
		return null;
	}
	const groups = scoped
		? [
				{
					id: "workspace",
					title: "Workspace",
					hint: "This workspace: its own resource metrics",
					items: inMetricOrder(metadata.filter((m) => !isHostMetric(m))),
				},
				{
					id: "cluster",
					title: scope === "node" ? "Node" : "Cluster",
					hint:
						scope === "node"
							? "The actual node running this workspace"
							: "Aggregate metrics across the cluster",
					items: inMetricOrder(host),
				},
			].filter((group) => !restricted || group.id === "workspace")
		: groupMetadata(metadata);
	const maximum = (m: WorkspaceAgentMetadata) => {
		if (!scoped) return undefined;
		if (!isHostMetric(m))
			return workspaceMaximum(m, infrastructure?.allocation);
		const rank = metricRank(m);
		const value =
			infrastructure?.[scope]?.[
				rank === 0
					? "cpu"
					: rank === 1
						? "memory"
						: rank === 2
							? "disk"
							: "load"
			];
		return value
			? infrastructureMaximum(
					value.total,
					value.unit,
					"Capacity",
					rank === 0
						? "cpu"
						: rank === 1
							? "memory"
							: rank === 2
								? "disk"
								: "load",
				)
			: null;
	};
	const item = (m: WorkspaceAgentMetadata) => (
		<MetadataItem
			key={m.description.key}
			item={m}
			maximum={maximum(m)}
			maximumUnavailableLabel={
				isHostMetric(m)
					? "Capacity unavailable"
					: "Assigned maximum unavailable"
			}
			history={historyOf(m.description.key)}
			every={every}
			pausedAt={pausedAt}
		/>
	);
	// Workspace metrics stay separate from trusted node or cluster observations.
	if (groups.length === 1 && groups[0].id === "other") {
		return (
			<section
				className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-4"
				data-metrics
			>
				{metadata.map(item)}
			</section>
		);
	}
	return (
		<section
			className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,27rem),1fr))] items-stretch gap-3 pb-1"
			data-metrics
		>
			{groups.map((g) => (
				<div
					key={g.id}
					role="group"
					aria-label={g.title}
					title={g.hint}
					className="flex w-full min-w-0 flex-col gap-2 rounded-2xl border border-solid border-border bg-surface-secondary/40 px-3.5 pt-3 pb-4"
					data-testid={`metrics-group-${g.id}`}
				>
					<div className="grid min-h-9 min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 text-xs font-semibold tracking-wide text-content-secondary">
						<div className="min-w-0">
							{g.id === "workspace" && workspaceName && (
								<span
									className="inline-block min-w-0 max-w-[min(100%,12rem)] truncate rounded-full bg-surface-tertiary px-2 py-0.5 text-[9px] font-medium normal-case"
									title={workspaceName}
								>
									{workspaceName}
								</span>
							)}
							{g.id === "cluster" && scoped && scope === "node" && (
								<span
									className="inline-block min-w-0 max-w-[min(100%,12rem)] truncate rounded-full bg-surface-tertiary px-2 py-0.5 text-[9px] font-medium normal-case"
									title={
										infrastructure?.nodeName ??
										"No single workspace node is available"
									}
								>
									{infrastructure?.nodeName ??
										(infrastructureLoading
											? "Locating node…"
											: "Node unavailable")}
								</span>
							)}
						</div>
						<div className="py-0.5 text-center uppercase">
							{g.id === "cluster" && scoped ? (
								<div className="flex min-w-0 flex-wrap items-center justify-center gap-2 normal-case">
									<span
										className={
											scope === "node" ? "text-content-primary" : undefined
										}
									>
										Node
									</span>
									<Switch
										size="sm"
										aria-label="Show cluster metrics"
										checked={scope === "cluster"}
										disabled={!onScopeChange}
										onCheckedChange={(checked) =>
											onScopeChange?.(checked ? "cluster" : "node")
										}
									/>
									<span
										className={
											scope === "cluster" ? "text-content-primary" : undefined
										}
									>
										Cluster
									</span>
								</div>
							) : (
								g.title
							)}
						</div>
						<span aria-hidden />
					</div>
					{g.id === "cluster" && infrastructureError ? (
						<p
							role="alert"
							className="m-0 max-w-full break-words text-center text-xs text-content-destructive"
						>
							{getErrorMessage(
								infrastructureError,
								"Infrastructure metrics could not be refreshed.",
							)}
						</p>
					) : null}
					{g.id === "workspace" && g.items.length === 0 && (
						<p
							role="status"
							className="m-0 text-center text-xs text-content-secondary"
						>
							No workspace metrics reported.
						</p>
					)}
					{g.id === "cluster" && g.items.length === 0 && (
						<p
							role="status"
							className="m-0 text-center text-xs text-content-secondary"
						>
							{infrastructureLoading
								? "Loading infrastructure metrics…"
								: "Infrastructure metrics unavailable."}
						</p>
					)}
					{/* Platform: the group fills its share of the row; its metrics spread across it, each a little wider */}
					<div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] items-start gap-3">
						{g.items.map(item)}
					</div>
				</div>
			))}
		</section>
	);
};

type AgentMetadataProps = {
	workspace?: Pick<Workspace, "id" | "name" | "organization_id">;
	agent: WorkspaceAgent;
	initialMetadata?: WorkspaceAgentMetadata[];
	/** Platform: stopped at (ms) - no contact with the workspace: the graphs stay as they were then. */
	pausedAt?: number;
};

// Platform: the longest wait between attempts to watch the metadata again (ms)
const maxRetryDelayMs = 30_000;

export const AgentMetadata: React.FC<AgentMetadataProps> = ({
	agent,
	workspace,
	initialMetadata,
	pausedAt,
}) => {
	const [activeMetadata, setActiveMetadata] = useState(initialMetadata);
	const [scope, setScope] = useState<InfrastructureScope>("node");
	const infrastructure = useQuery({
		...workspaceInfrastructureMetrics(
			workspace?.organization_id ?? "",
			workspace?.id ?? "",
		),
		enabled: Boolean(workspace) && pausedAt === undefined,
	});
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
	// reading and the Cloud Drive's kept out of the metric displays
	useEffect(() => {
		if (activeMetadata) {
			publishAgentMetadata(agent.id, activeMetadata);
		}
	}, [agent.id, activeMetadata]);
	const shown = useMemo(
		() =>
			activeMetadata?.filter(
				(m) => !isNetworkMetadata(m) && !isCloudDriveMetadata(m),
			),
		[activeMetadata],
	);

	if (shown === undefined) {
		return (
			<section className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-4">
				<AgentMetadataSkeleton />
			</section>
		);
	}

	return (
		<AgentMetadataView
			metadata={shown}
			workspaceName={workspace?.name}
			infrastructure={infrastructure.data}
			infrastructureLoading={infrastructure.isLoading}
			infrastructureError={infrastructure.error}
			scope={scope}
			onScopeChange={setScope}
			historyScope={agent.id}
			pausedAt={pausedAt}
		/>
	);
};

const AgentMetadataSkeleton: React.FC = () => {
	return (
		<div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,4rem),1fr))] gap-4">
			<div className="leading-relaxed flex min-w-0 flex-col">
				<Skeleton width={40} height={6} variant="text" className="max-w-full" />
				<Skeleton width={65} height={8} variant="text" className="max-w-full" />
			</div>

			<div className="leading-relaxed flex min-w-0 flex-col">
				<Skeleton width={40} height={6} variant="text" className="max-w-full" />
				<Skeleton width={65} height={8} variant="text" className="max-w-full" />
			</div>

			<div className="leading-relaxed flex min-w-0 flex-col">
				<Skeleton width={40} height={6} variant="text" className="max-w-full" />
				<Skeleton width={65} height={8} variant="text" className="max-w-full" />
			</div>
		</div>
	);
};
