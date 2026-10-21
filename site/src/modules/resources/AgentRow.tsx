import { cn } from "cn";
import {
	CopyIcon,
	EllipsisIcon,
	InfoIcon,
	PackageIcon,
	PlayIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import type { VariableSizeList as List, ListOnScrollProps } from "react-window";
import type {
	AgentScriptTiming,
	Template,
	Workspace,
	WorkspaceAgent,
	WorkspaceAgentMetadata,
	WorkspaceAgentScript,
} from "#/api/typesGenerated";
import { CheckIcon } from "#/components/AnimatedIcons/Check";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import type { Line } from "#/components/Logs/LogLine";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/Tabs/Tabs";
import { useKebabMenu } from "#/components/Tabs/utils/useKebabMenu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { useProxy } from "#/contexts/ProxyContext";
import { useClipboard } from "#/hooks/useClipboard";
import { useFeatureVisibility } from "#/modules/dashboard/useFeatureVisibility";
import { AgentBorderFx } from "#/modules/platform/agentBorder/AgentBorderFx";
import { agentBorderState } from "#/modules/platform/agentBorder/agentBorderState";
import { AddPanelTab } from "#/modules/platform/agentPanels/AddPanelTab";
import {
	AgentAppPanel,
	canBePanel,
} from "#/modules/platform/agentPanels/AgentAppPanel";
import {
	AgentPortPanel,
	AgentWebPanel,
} from "#/modules/platform/agentPanels/AgentLinkPanels";
import { AgentPanels } from "#/modules/platform/agentPanels/AgentPanels";
import { useAgentPanels } from "#/modules/platform/agentPanels/agentPanelsStore";
import { AgentTerminalSection } from "#/modules/platform/agentTerminal/AgentTerminalSection";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import { CloudDriveGlyph } from "#/modules/platform/cloudDrive/CloudDriveGlyph";
import { LockdownBadge } from "#/modules/platform/lockdown/Lockdown";
import { AgentNetworkLeds } from "#/modules/platform/networkLeds/AgentNetworkLeds";
import { AgentNetworkPill } from "#/modules/platform/networkLeds/AgentNetworkPill";
import { WorkspaceInitializing } from "#/modules/platform/workspaceInitializing/WorkspaceInitializing";
import {
	agentAppsReady,
	agentInitializing,
} from "#/modules/platform/workspaceInitializing/workspaceReadiness";
import { useWorkspaceContactLost } from "#/modules/platform/workspaceLiveness/liveness";
import { WorkspaceUptime } from "#/modules/platform/workspaceUptime/WorkspaceUptime";
import {
	agentConnectionMessages,
	getAgentConnectivityIssues,
	getAgentScriptIssues,
} from "#/modules/workspaces/health";
import { AgentAlert } from "#/pages/WorkspacePage/AgentAlert";
import { AppStatuses } from "#/pages/WorkspacePage/AppStatuses";
import { getWorkspaceListeningPortsProtocol } from "#/utils/portForward";
import { AgentApps, organizeAgentApps } from "./AgentApps/AgentApps";
import { AgentDevcontainerCard } from "./AgentDevcontainerCard";
import { AgentExternal } from "./AgentExternal";
import { AgentLatency } from "./AgentLatency";
import { AGENT_LOG_LINE_HEIGHT } from "./AgentLogs/AgentLogLine";
import { AgentLogs } from "./AgentLogs/AgentLogs";
import { AgentMetadata } from "./AgentMetadata";
import { AgentStatus } from "./AgentStatus";
import { AgentVersion } from "./AgentVersion";
import { DownloadSelectedAgentLogsButton } from "./DownloadSelectedAgentLogsButton";
import { MetricsIntervalButton } from "./MetricsIntervalButton";
import { PortForwardButton } from "./PortForwardButton";
import { AgentSSHButton } from "./SSHButton/SSHButton";
import { TerminalLink } from "./TerminalLink/TerminalLink";
import { useAgentContainers } from "./useAgentContainers";
import { useAgentLogs } from "./useAgentLogs";
import { canShowPortForwarding, usePortsData } from "./usePortsData";
import { VSCodeDesktopButton } from "./VSCodeDesktopButton/VSCodeDesktopButton";
import { WildcardHostnameWarning } from "./WildcardHostnameWarning";

type AgentRowProps = {
	agent: WorkspaceAgent;
	subAgents?: WorkspaceAgent[];
	workspace: Workspace;
	template: Template;
	initialMetadata?: WorkspaceAgentMetadata[];
	agentScriptTimings?: readonly AgentScriptTiming[];
	onUpdateAgent: () => void;
	/** Platform: under the card's last panel, inside it (the workspace's Build timeline). */
	footer?: React.ReactNode;
};

const statusBorderClassByStatus: Partial<
	Record<WorkspaceAgent["status"], string>
> = {
	connected: "border-border-success",
	connecting: "border-border-pending",
	timeout: "border-border-warning",
};

const statusBorderClassByLifecycle: Partial<
	Record<WorkspaceAgent["lifecycle_state"], string>
> = {
	starting: "border-border-pending",
	shutting_down: "border-border-pending",
	ready: "border-border-success",
	// Script errors and timeouts do not affect agent connectivity; they are
	// surfaced in the per-script log tabs instead.
	start_timeout: "border-border-success",
	shutdown_timeout: "border-border-warning",
	start_error: "border-border-success",
	shutdown_error: "border-border-warning",
	off: "border-border",
};

const getAgentBorderClass = (
	agent: WorkspaceAgent,
	hasErrorState: boolean,
): string => {
	if (hasErrorState) {
		return "border-border";
	}

	// Lifecycle state is more specific than connection status, so it wins.
	return (
		statusBorderClassByLifecycle[agent.lifecycle_state] ??
		statusBorderClassByStatus[agent.status] ??
		"border-border"
	);
};

const STARTUP_SCRIPT_DISPLAY_NAME = "Startup Script";

// A script is considered failed if it exited with a non-zero code, or if its
// status reports a known failure mode (anything other than "ok"). Kept aligned
// with the per-tab error indicator so the auto-selected tab matches the visual
// warning badge.
const isScriptFailed = (script: WorkspaceAgentScript | undefined): boolean =>
	Boolean(script?.exit_code || (script?.status && script.status !== "ok"));

export const AgentRow: React.FC<AgentRowProps> = ({
	agent,
	subAgents,
	workspace,
	template,
	onUpdateAgent,
	initialMetadata,
	footer,
}) => {
	const { browser_only, workspace_external_agent } = useFeatureVisibility();
	const appSections = organizeAgentApps(agent.apps);
	const hasAppsToDisplay =
		!browser_only || appSections.some((it) => it.apps.length > 0);
	const isExternalAgent = workspace.latest_build.has_external_agent;
	// Platform: the apps (and the terminal) open only once the workspace is
	// ready; until then WorkspaceInitializing stands in for them.
	const appsReady = agentAppsReady(agent);
	const initializing = agentInitializing(workspace, agent) && !isExternalAgent;
	const shouldDisplayAgentApps = appsReady && hasAppsToDisplay;
	const hasVSCodeApp =
		agent.display_apps.includes("vscode") ||
		agent.display_apps.includes("vscode_insiders");
	const showVSCode = hasVSCodeApp && !browser_only;

	const hasStartupFeatures = Boolean(agent.logs_length);
	const runningScriptsCount = agent.scripts.filter(
		(s) => s.run_on_start && !s.status,
	).length;
	// Connectivity issues drive agent panel styling (border color, warning
	// badge). Script issues are kept out of that styling so a failed script
	// does not imply a connectivity problem, but they still auto-expand the
	// logs so the failing script's tab surfaces on its own.
	// Platform: "Workspace agent is connecting" is WorkspaceInitializing's to say.
	const connectivityIssues = getAgentConnectivityIssues(agent).filter(
		(issue) => issue.title !== agentConnectionMessages.connecting.title,
	);
	const hasConnectivityIssues = connectivityIssues.length > 0;
	const hasWarningConnectivityIssues = connectivityIssues.some(
		(i) => i.severity === "warning",
	);
	const hasScriptIssues = getAgentScriptIssues(agent).length > 0;
	const { proxy } = useProxy();
	const [showLogs, setShowLogs] = useState(
		(agent.lifecycle_state !== "ready" ||
			hasConnectivityIssues ||
			hasScriptIssues) &&
			hasStartupFeatures,
	);
	const agentLogs = useAgentLogs({ agentId: agent.id, enabled: showLogs });
	const logListRef = useRef<List>(null);
	const logListDivRef = useRef<HTMLDivElement>(null);
	const [bottomOfLogs, setBottomOfLogs] = useState(true);

	useEffect(() => {
		setShowLogs(
			(agent.lifecycle_state !== "ready" ||
				hasConnectivityIssues ||
				hasScriptIssues) &&
				hasStartupFeatures,
		);
	}, [
		agent.lifecycle_state,
		hasConnectivityIssues,
		hasScriptIssues,
		hasStartupFeatures,
	]);

	// This is a layout effect to remove flicker when we're scrolling to the bottom.
	useLayoutEffect(() => {
		// If we're currently watching the bottom, we always want to stay at the bottom.
		if (bottomOfLogs && logListRef.current) {
			logListRef.current.scrollToItem(agentLogs.length - 1, "end");
		}
	}, [showLogs, agentLogs, bottomOfLogs]);

	// This is a bit of a hack on the react-window API to get the scroll position.
	// If we're scrolled to the bottom, we want to keep the list scrolled to the bottom.
	// This makes it feel similar to a terminal that auto-scrolls downwards!
	const handleLogScroll = (props: ListOnScrollProps) => {
		if (
			props.scrollOffset === 0 ||
			props.scrollUpdateWasRequested ||
			!logListDivRef.current
		) {
			return;
		}
		// The parent holds the height of the list!
		const parent = logListDivRef.current.parentElement;
		if (!parent) {
			return;
		}
		// Use the parent's scrollHeight (not the inner div's) so that
		// any padding on the scroll container is included in the
		// calculation and doesn't inflate the "at bottom" zone.
		const distanceFromBottom =
			parent.scrollHeight - (props.scrollOffset + parent.clientHeight);
		setBottomOfLogs(distanceFromBottom < AGENT_LOG_LINE_HEIGHT);
	};

	const devcontainers = useAgentContainers(agent);
	const agentCount = workspace.latest_build.resources.reduce(
		(count, resource) =>
			count + (resource.agents?.filter((a) => !a.parent_id).length ?? 0),
		0,
	);

	// This is used to show the parent apps of the devcontainer.
	const [showParentApps, setShowParentApps] = useState(false);

	const anyRunningOrStartingDevcontainers =
		devcontainers?.find(
			(dc) => dc.status === "running" || dc.status === "starting",
		) !== undefined;

	// We only want to hide the parent apps by default when there are dev
	// containers that are either starting or running. If they are all in
	// the stopped state, it doesn't make sense to hide the parent apps.
	let shouldDisplayAppsSection = shouldDisplayAgentApps;
	if (anyRunningOrStartingDevcontainers && !showParentApps) {
		shouldDisplayAppsSection = false;
	}

	// Check if any devcontainers have errors to gray out agent border
	const hasDevcontainerErrors = devcontainers?.some((dc) => dc.error);

	const hasSubdomainApps = agent.apps?.some((app) => app.subdomain);
	const shouldShowWildcardWarning =
		hasSubdomainApps && !proxy.proxy?.wildcard_hostname;
	const borderClass = getAgentBorderClass(
		agent,
		Boolean(hasDevcontainerErrors || shouldShowWildcardWarning),
	);
	// Platform: the animated borders (AgentBorderFx) replace Coder's border
	// colours, unless the user menu's "Animations" switch is off.
	const animations = useAnimationsEnabled();
	// Platform: no contact with Coder about the workspace (WorkspacePage), or its agent not connected: the card's
	// live parts (graphs, network lights) stop where they were and turn grey; without contact the border too.
	const contactLostAt = useWorkspaceContactLost(workspace.id);
	const contactLost = contactLostAt !== null;
	const live =
		!contactLost &&
		workspace.latest_build.status === "running" &&
		agent.status === "connected";
	const [stoppedAt, setStoppedAt] = useState<number>();
	useEffect(() => {
		setStoppedAt(live ? undefined : Date.now());
	}, [live]);
	const fxState = !animations
		? null
		: contactLost && workspace.latest_build.transition === "start"
			? "lost"
			: agentBorderState(workspace, agent, {
					scriptIssues: hasScriptIssues,
					otherIssues: Boolean(
						hasDevcontainerErrors || shouldShowWildcardWarning,
					),
				});
	// Platform: the drop-down panels (Logs, Terminal and the apps the user
	// embeds), in the user's order.
	const panels = useAgentPanels(workspace.id, agent.name);
	const [justAdded, setJustAdded] = useState<string>();
	const panelApps = agent.apps.filter(canBePanel);
	// Any app goes in a panel: the listening ports too, where port forwarding is offered (as Open ports).
	const portsOffered = canShowPortForwarding(
		agent,
		proxy.preferredWildcardHostname,
	);
	const { listeningPorts } = usePortsData(
		workspace,
		agent,
		portsOffered && agent.status === "connected",
	);
	const portProtocol = getWorkspaceListeningPortsProtocol(workspace.id);
	const [selectedLogTab, setSelectedLogTab] = useState("all");
	const hasAutoSelectedLogTabRef = useRef(false);
	// Auto-select the first log tab whose script failed and has rendered output.
	useEffect(() => {
		if (hasAutoSelectedLogTabRef.current) {
			return;
		}
		const failedSourceWithLogs = agent.log_sources.find((logSource) => {
			const script = agent.scripts.find(
				(s) => s.log_source_id === logSource.id,
			);
			if (!isScriptFailed(script)) {
				return false;
			}
			return agentLogs.some(
				(log) =>
					log.source_id === logSource.id && (log.output?.length ?? 0) > 0,
			);
		});
		if (failedSourceWithLogs) {
			hasAutoSelectedLogTabRef.current = true;
			setSelectedLogTab(failedSourceWithLogs.id);
		}
	}, [agent.log_sources, agent.scripts, agentLogs]);
	const handleSelectedLogTabChange = (value: string) => {
		hasAutoSelectedLogTabRef.current = true;
		setSelectedLogTab(value);
	};
	const sortedSourceLogTabs = agent.log_sources
		.filter((logSource) => {
			// Remove the logSources that have no entries.
			return agentLogs.some(
				(log) =>
					log.source_id === logSource.id && (log.output?.length ?? 0) > 0,
			);
		})
		.map((logSource) => {
			const script = agent.scripts.find(
				(s) => s.log_source_id === logSource.id,
			);
			return {
				// Show the icon for the log source if it has one.
				// In the startup script case, we show a bespoke play icon.
				startIcon: logSource.icon ? (
					<ExternalImage
						src={logSource.icon}
						alt=""
						className="size-icon-xs shrink-0"
					/>
				) : logSource.display_name === STARTUP_SCRIPT_DISPLAY_NAME ? (
					<PlayIcon className="size-icon-xs shrink-0" />
				) : null,
				title: logSource.display_name,
				value: logSource.id,
				error: isScriptFailed(script),
			};
		})
		.sort((a, b) => {
			// Errored scripts first, then startup script, then the rest.
			if (a.error && !b.error) {
				return -1;
			}
			if (b.error && !a.error) {
				return 1;
			}
			if (a.title === STARTUP_SCRIPT_DISPLAY_NAME) {
				return -1;
			}
			if (b.title === STARTUP_SCRIPT_DISPLAY_NAME) {
				return 1;
			}
			return a.title.localeCompare(b.title);
		});
	const logTabs: {
		startIcon?: React.ReactNode;
		title: string;
		value: string;
		error: boolean;
	}[] = [
		{
			title: "All Logs",
			value: "all",
			startIcon: <PackageIcon className="size-icon-xs shrink-0" />,
			error: false,
		},
		...sortedSourceLogTabs,
	];
	const hasAnyLogs = agentLogs.length > 0;
	const shouldExpandLogs =
		showLogs || (!hasStartupFeatures && hasConnectivityIssues);
	const shouldShowLogsTabs = hasStartupFeatures && hasAnyLogs;
	const logTabsMeasureEnabled = shouldShowLogsTabs && showLogs;
	const {
		containerRef: logTabsListContainerRef,
		visibleTabs: visibleLogTabs,
		overflowTabs: overflowLogTabs,
		getTabMeasureProps,
	} = useKebabMenu({
		tabs: logTabs,
		enabled: logTabsMeasureEnabled,
		isActive: showLogs,
	});
	const overflowLogTabValuesSet = new Set(
		overflowLogTabs.map((tab) => tab.value),
	);
	const selectedLogs =
		selectedLogTab === "all"
			? agentLogs
			: agentLogs.filter((log) => log.source_id === selectedLogTab);
	const selectedLogLines: readonly Line[] = selectedLogs.map((log) => ({
		id: log.id,
		output: log.output,
		time: log.created_at,
		level: log.level,
		sourceId: log.source_id,
	}));
	const allLogsText = agentLogs.map((log) => log.output).join("\n");
	const selectedLogsText = selectedLogs.map((log) => log.output).join("\n");
	const hasSelectedLogs = selectedLogs.length > 0;
	const { showCopiedSuccess, copyToClipboard } = useClipboard();
	const downloadableLogSets = logTabs
		.filter((tab) => tab.value !== "all")
		.map((tab) => {
			const logsText = agentLogs
				.filter((log) => log.source_id === tab.value)
				.map((log) => log.output)
				.join("\n");
			const filenameSuffix = tab.title
				.toLowerCase()
				.replaceAll(/[^a-z0-9]+/g, "-")
				.replaceAll(/(^-|-$)/g, "");
			return {
				label: tab.title,
				filenameSuffix: filenameSuffix || tab.value,
				logsText,
				startIcon: tab.startIcon,
			};
		});

	return (
		<AgentBorderFx key={agent.id} state={fxState}>
			<div
				className={cn(
					"flex max-w-full flex-col rounded-lg border border-solid bg-surface-primary text-sm shadow-md overflow-clip",
					fxState ? "border-transparent" : borderClass,
				)}
			>
				{/* Platform: px-8 - its right end (Lock Down) lines up with the apps' and the metrics' squircles below */}
				<header className="flex flex-wrap items-center justify-between gap-4 px-8 pt-4 leading-normal md:gap-6 [&:has(+_[role='alert'])]:pb-4">
					<div className="flex min-w-0 items-center gap-6 text-sm text-content-secondary">
						<div className="flex min-w-0 w-full items-center gap-4 md:w-auto">
							<span
								className={cn(
									"inline-flex",
									contactLost && "opacity-60 grayscale",
								)}
								title={
									contactLost
										? "No contact with Coder: the agent's status as last seen"
										: undefined
								}
							>
								<AgentStatus agent={agent} />
							</span>
							{/* Platform: the workspace's name (its agent's, after it, when it has several). */}
							<span
								className="block max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold text-content-primary"
								title={`Workspace ${workspace.name}, agent ${agent.name}`}
							>
								{workspace.name}
								{agentCount > 1 && (
									<span className="font-normal text-content-secondary">
										{" "}
										/ {agent.name}
									</span>
								)}
							</span>
							{/* Platform: the workspace's network lights (RX / TX), between its name and the latency */}
							{agent.status === "connected" && (
								<AgentNetworkLeds
									agentId={agent.id}
									workspaceId={workspace.id}
									stoppedAt={stoppedAt}
								/>
							)}
						</div>
						{agent.status === "connected" && (
							<>
								<AgentVersion
									agent={agent}
									onUpdate={onUpdateAgent}
									workspaceOutdated={workspace.outdated}
								/>
								{/* Platform: no contact with Coder - the last latency, greyed */}
								<span
									className={cn(
										"inline-flex",
										contactLost && "opacity-60 grayscale",
									)}
									data-stale={contactLost || undefined}
								>
									<AgentLatency agent={agent} />
								</span>
							</>
						)}
						{agent.status === "connecting" && (
							<>
								<Skeleton width={160} variant="text" />
								<Skeleton width={36} variant="text" />
							</>
						)}
					</div>

					<div className="flex items-center gap-2">
						{anyRunningOrStartingDevcontainers && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowParentApps((show) => !show)}
							>
								Show parent apps
								<ChevronDownIcon open={showParentApps} />
							</Button>
						)}

						{appsReady &&
							!browser_only &&
							agent.display_apps.includes("ssh_helper") && (
								<AgentSSHButton
									workspaceName={workspace.name}
									agentName={agent.name}
									workspaceOwnerUsername={workspace.owner_name}
								/>
							)}
						{/* Platform: the metric graphs' Metrics Interval, to the left of Open ports */}
						<MetricsIntervalButton agentId={agent.id} />
						{appsReady &&
							canShowPortForwarding(agent, proxy.preferredWildcardHostname) && (
								<PortForwardButton
									host={proxy.preferredWildcardHostname}
									workspace={workspace}
									agent={agent}
									template={template}
								/>
							)}
						{/* Platform: admins' Lock Down badge and its menu, right of Open Ports */}
						<LockdownBadge workspace={workspace} />
					</div>
				</header>

				<div className="flex flex-col gap-8 px-8 pt-8 pb-12">
					{/* Platform: under the header, above the apps: the network's last minute under the workspace's name, how long
					    the workspace has been on under Open Ports; two pills of one size */}
					{agent.status === "connected" && (
						<div className="-my-4 flex items-center justify-between gap-3 empty:hidden">
							<AgentNetworkPill
								agentId={agent.id}
								workspaceId={workspace.id}
								stoppedAt={stoppedAt}
							/>
							<span className="ml-auto flex items-center gap-2 empty:hidden">
								{/* Platform: connected to its owner's Cloud Drive (a HUD of it on hover), left of the uptime */}
								<CloudDriveGlyph workspace={workspace} />
								{/* Platform: no contact with Coder - not counting on as if it ran, greyed */}
								<span
									className={cn(
										"inline-flex",
										contactLost && "opacity-60 grayscale",
									)}
									data-stale={contactLost || undefined}
								>
									<WorkspaceUptime
										workspace={workspace}
										stoppedAt={contactLostAt ?? undefined}
									/>
								</span>
							</span>
						</div>
					)}
					{workspace.latest_app_status?.agent_id === agent.id && (
						<section>
							<h3 className="sr-only">App statuses</h3>
							<AppStatuses workspace={workspace} agent={agent} />
						</section>
					)}

					{shouldShowWildcardWarning && <WildcardHostnameWarning />}

					{initializing && (
						<WorkspaceInitializing workspace={workspace} agent={agent} />
					)}

					{/* Platform: the apps in a squircle as wide as the metrics' squircles below it, both filling the card: the
					    apps centred in equal columns across it (as many as fit, at least 150 px each) */}
					<div className="grid w-full max-w-full gap-4 empty:hidden">
						{shouldDisplayAppsSection && (
							<section
								className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] justify-center gap-3 rounded-2xl border border-solid border-border bg-surface-secondary/40 p-4 empty:hidden [&>*]:w-full [&>*]:justify-center"
								data-testid="agent-apps"
							>
								{shouldDisplayAgentApps && (
									<>
										{showVSCode && (
											<VSCodeDesktopButton
												userName={workspace.owner_name}
												workspaceName={workspace.name}
												agentName={agent.name}
												folderPath={agent.expanded_directory}
												displayApps={agent.display_apps}
											/>
										)}
										{appSections.map((section, i) => (
											<AgentApps
												key={section.group ?? i}
												section={section}
												agent={agent}
												workspace={workspace}
											/>
										))}
									</>
								)}

								{agent.display_apps.includes("web_terminal") && (
									<TerminalLink
										workspaceName={workspace.name}
										agentName={agent.name}
										userName={workspace.owner_name}
									/>
								)}
							</section>
						)}

						{/* Platform: not live - the graphs stop where they were, greyed */}
						<div
							className={cn(
								"min-w-0 transition-[filter,opacity] duration-500",
								!live && "opacity-60 grayscale",
							)}
							data-stale={!live || undefined}
						>
							<AgentMetadata
								initialMetadata={initialMetadata}
								agent={agent}
								pausedAt={stoppedAt}
							/>
						</div>
					</div>

					{devcontainers && devcontainers.length > 0 && (
						<section className="flex flex-col gap-4">
							{devcontainers.map((devcontainer) => {
								return (
									<AgentDevcontainerCard
										key={devcontainer.id}
										devcontainer={devcontainer}
										workspace={workspace}
										template={template}
										wildcardHostname={proxy.preferredWildcardHostname}
										parentAgent={agent}
										subAgents={subAgents ?? []}
									/>
								);
							})}
						</section>
					)}

					{isExternalAgent &&
						(agent.status === "timeout" || agent.status === "connecting") &&
						workspace_external_agent && (
							<AgentExternal agent={agent} workspace={workspace} />
						)}
				</div>

				<AgentPanels
					order={panels.order}
					onReorder={panels.reorder}
					addTab={
						<AddPanelTab
							apps={panelApps}
							ports={portsOffered ? (listeningPorts ?? []) : []}
							protocol={portProtocol}
							disabled={!appsReady}
							onAdd={(content) => setJustAdded(panels.add(content))}
						/>
					}
					panels={[
						{
							id: "logs",
							label: "Logs",
							render: (handle) => (
								<section className="border-0 border-t border-solid border-border">
									<Collapsible
										open={shouldExpandLogs}
										onOpenChange={setShowLogs}
									>
										<div className="px-4 py-2 relative flex items-center gap-2">
											{handle}
											<CollapsibleTrigger asChild>
												<Button
													variant="subtle"
													className="after:content-[''] after:absolute after:inset-0"
												>
													<ChevronDownIcon open={showLogs} />
													<span>Logs</span>
													{agent.lifecycle_state === "starting" &&
														runningScriptsCount > 0 &&
														connectivityIssues.length === 0 && (
															<Badge
																variant="default"
																size="xs"
																className="ml-1.5"
																svgSize="sm"
															>
																<Spinner
																	size="lg"
																	loading
																	className="text-content-secondary -ml-1"
																/>
																<span>{runningScriptsCount}</span>
															</Badge>
														)}
													{hasConnectivityIssues && (
														<Badge
															variant={
																hasWarningConnectivityIssues
																	? "warning"
																	: "info"
															}
															size="xs"
															className="ml-1.5"
														>
															{hasWarningConnectivityIssues ? (
																<TriangleAlertIcon className="-ml-0.5" />
															) : (
																<InfoIcon className="-ml-0.5" />
															)}
															<span>{connectivityIssues.length}</span>
														</Badge>
													)}
												</Button>
											</CollapsibleTrigger>
										</div>
										<CollapsibleContent>
											<div
												className={cn(
													"px-4",
													hasStartupFeatures ? "pb-4" : "py-4",
												)}
											>
												{/*
								Gate the spinner on `shouldExpandLogs` so it does not flash while
								CollapsibleContent is closing.
							*/}
												{shouldExpandLogs &&
													hasStartupFeatures &&
													!(hasConnectivityIssues || shouldShowLogsTabs) && (
														<div className="h-[300px] flex items-center justify-center">
															<Spinner
																size="lg"
																loading
																className="block mx-auto"
															/>
														</div>
													)}
												{/* Platform: an agent with no log lines at all (its scripts printed nothing) said so
												instead of a spinner that never ends. */}
												{shouldExpandLogs &&
													!hasStartupFeatures &&
													!hasConnectivityIssues && (
														<p
															className="m-0 py-6 text-center text-sm text-content-secondary"
															data-testid="agent-logs-empty"
														>
															No logs yet: this workspace&apos;s startup scripts
															have not printed anything.
														</p>
													)}
												{hasConnectivityIssues && (
													<div className="mb-4 flex flex-col gap-3">
														{connectivityIssues.map((issue) => (
															<AgentAlert
																key={`${issue.title}-${issue.detail}`}
																{...issue}
																troubleshootingURL={agent.troubleshooting_url}
															/>
														))}
													</div>
												)}
												{shouldShowLogsTabs && (
													<div className="border border-solid rounded-md overflow-clip">
														<Tabs
															className="-mx-px -mt-px"
															value={selectedLogTab}
															onValueChange={handleSelectedLogTabChange}
														>
															<div className="flex items-stretch">
																<div className="min-w-0 flex-1 overflow-hidden">
																	<TabsList
																		variant="outsideBox"
																		overflowKebabMenu
																		ref={logTabsListContainerRef}
																		className="px-4"
																	>
																		{visibleLogTabs.map((tab) => (
																			<TabsTrigger
																				key={tab.value}
																				value={tab.value}
																				{...getTabMeasureProps(tab.value)}
																			>
																				{tab.startIcon}
																				<span className="whitespace-nowrap">
																					{tab.title}
																				</span>
																				{tab.error && (
																					<Badge
																						variant="warning"
																						size="xs"
																						className="ml-1.5"
																					>
																						<TriangleAlertIcon />
																					</Badge>
																				)}
																			</TabsTrigger>
																		))}
																		{overflowLogTabs.length > 0 && (
																			<DropdownMenu>
																				<DropdownMenuTrigger asChild>
																					<button
																						type="button"
																						data-slot="tabs-trigger"
																						data-log-overflow-trigger
																						data-state={
																							overflowLogTabValuesSet.has(
																								selectedLogTab,
																							)
																								? "active"
																								: "inactive"
																						}
																						aria-label="More log tabs"
																						className={cn(
																							"cursor-pointer -mb-px",
																							"inline-flex items-center justify-center",
																							"border-none py-3 bg-transparent text-inherit",
																							"transition-colors duration-150 ease-linear",
																						)}
																					>
																						<EllipsisIcon className="size-icon-sm" />
																						<span className="sr-only">
																							More log tabs
																						</span>
																					</button>
																				</DropdownMenuTrigger>
																				<DropdownMenuContent
																					align="end"
																					className="max-h-56 overflow-y-auto"
																				>
																					<DropdownMenuRadioGroup
																						value={selectedLogTab}
																						onValueChange={
																							handleSelectedLogTabChange
																						}
																					>
																						{overflowLogTabs.map((tab) => (
																							<DropdownMenuRadioItem
																								key={tab.value}
																								value={tab.value}
																								className="gap-2"
																							>
																								{tab.startIcon}
																								<span className="whitespace-nowrap">
																									{tab.title}
																								</span>
																								{tab.error && (
																									<Badge
																										variant="warning"
																										size="xs"
																										className="ml-1.5"
																									>
																										<TriangleAlertIcon />
																									</Badge>
																								)}
																							</DropdownMenuRadioItem>
																						))}
																					</DropdownMenuRadioGroup>
																				</DropdownMenuContent>
																			</DropdownMenu>
																		)}
																	</TabsList>
																</div>
																<div
																	className={cn(
																		"shrink-0 flex items-center gap-2 pl-2 pr-3",
																		"border-solid border-0 border-b border-l",
																	)}
																>
																	<TooltipProvider>
																		<Tooltip>
																			<TooltipTrigger asChild>
																				<Button
																					variant="subtle"
																					size="sm"
																					className="min-w-0"
																					disabled={!hasSelectedLogs}
																					onClick={() =>
																						copyToClipboard(selectedLogsText)
																					}
																				>
																					{showCopiedSuccess ? (
																						<CheckIcon />
																					) : (
																						<CopyIcon />
																					)}
																				</Button>
																			</TooltipTrigger>
																			<TooltipContent>
																				{showCopiedSuccess
																					? "Copied!"
																					: "Copy selected logs"}
																			</TooltipContent>
																		</Tooltip>
																	</TooltipProvider>
																	<DownloadSelectedAgentLogsButton
																		agentName={agent.name}
																		logSets={downloadableLogSets}
																		allLogsText={allLogsText}
																		disabled={!hasAnyLogs}
																	/>
																</div>
															</div>
															{/*
											Using a singular TabsContent is necessary to avoid scrolling
											issues when the selected log tab changes.
										*/}
															<TabsContent value={selectedLogTab}>
																<AutoSizer disableHeight>
																	{({ width }) => (
																		<AgentLogs
																			ref={logListRef}
																			innerRef={logListDivRef}
																			height={256}
																			width={width}
																			onScroll={handleLogScroll}
																			logs={selectedLogLines}
																			sources={agent.log_sources}
																			overflowed={agent.logs_overflowed}
																			className="bg-transparent"
																			showSourceIcons={selectedLogTab === "all"}
																		/>
																	)}
																</AutoSizer>
															</TabsContent>
														</Tabs>
													</div>
												)}
											</div>
										</CollapsibleContent>
									</Collapsible>
								</section>
							),
						},
						{
							id: "terminal",
							label: "Terminal",
							render: (handle) => (
								<AgentTerminalSection
									agent={agent}
									workspace={workspace}
									ready={appsReady}
									handle={handle}
								/>
							),
						},
						...panels.apps.map((panel) => {
							const common = {
								id: panel.id,
								initiallyOpen: panel.id === justAdded,
								height: panel.height,
								onHeightChange: (height: number) =>
									panels.setHeight(panel.id, height),
								onRemove: () => panels.remove(panel.id),
							};
							if (panel.kind === "port") {
								return {
									id: panel.id,
									label: `Port ${panel.port}`,
									render: (handle: React.ReactNode) => (
										<AgentPortPanel
											{...common}
											handle={handle}
											workspace={workspace}
											agent={agent}
											ready={appsReady}
											host={proxy.preferredWildcardHostname}
											port={panel.port}
											protocol={panel.protocol}
											process={panel.process}
										/>
									),
								};
							}
							if (panel.kind === "web") {
								return {
									id: panel.id,
									label: panel.name || panel.url,
									render: (handle: React.ReactNode) => (
										<AgentWebPanel
											{...common}
											handle={handle}
											url={panel.url}
											name={panel.name}
										/>
									),
								};
							}
							const app = agent.apps.find((a) => a.slug === panel.slug);
							return {
								id: panel.id,
								label: app?.display_name || panel.slug,
								render: (handle: React.ReactNode) => (
									<AgentAppPanel
										{...common}
										workspace={workspace}
										agent={agent}
										app={app}
										slug={panel.slug}
										handle={handle}
										ready={appsReady}
									/>
								),
							};
						}),
					]}
				/>
				{footer}
			</div>
		</AgentBorderFx>
	);
};
