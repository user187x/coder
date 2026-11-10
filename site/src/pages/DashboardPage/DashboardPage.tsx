import { cn } from "cn";
import {
	CircuitBoardIcon,
	CloudIcon,
	CpuIcon,
	GaugeIcon,
	HardDriveIcon,
	MemoryStickIcon,
	MonitorIcon,
	NetworkIcon,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { PlatformError, type UserUIPreferences } from "#/api/platform";
import {
	cloudDriveSettings,
	HUD_REFRESH_MS,
	hudHistory,
	quotaMeResources,
	quotaReport,
	safe,
	updateUserUIPreferences,
	userUIPreferences,
	workspaceNetwork,
	workspaceResourceHistory,
} from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import {
	isLinked,
	useCloudDriveLinks,
} from "#/modules/platform/cloudDrive/CloudDriveSocket";
import { formatBytes } from "#/modules/platform/cloudDrive/drivePaths";
import { formatQuotaNumber } from "#/pages/UsersPage/quotaFormatting";
import { pageTitle } from "#/utils/page";
import {
	CardState,
	DashboardCard,
	RangePill,
	SuppliedBadge,
} from "./DashboardCard";
import {
	type DashboardScope,
	diskFromHistory,
	liveFromHistories,
	liveFromHud,
	networkSeries,
	RESOURCE_UNIT,
	scopeFromCluster,
	scopeFromMine,
	totalLimit,
} from "./dashboardModel";
import {
	NetworkCardBody,
	type NetworkReading,
	UsageCardBody,
} from "./LiveCards";
import { orderCards, type SortableCard, SortableCards } from "./SortableCards";
import { CloudDriveCardBody, GpuCardBody } from "./StorageCards";
import { SummaryCardBody } from "./SummaryCard";
import {
	type DiskReading,
	DisksCardBody,
	WorkspacesCardBody,
} from "./WorkspaceCards";

/** The Cloud Drive backend is checked less often than the rest; it changes rarely. */
const DRIVE_SETTINGS_REFRESH_MS = 30_000;

/**
 * The Dashboard: everything the signed-in account has allocated to the cluster for its workspaces, against its
 * quota, with live usage, its disks and its Cloud Drive. Admins can switch to the whole cluster against its
 * capacity. Every card refreshes at the HUD's interval until "Live" is switched off.
 */
const DashboardPage: React.FC = () => {
	const { user, permissions } = useAuthenticated();
	const isAdmin = Boolean(permissions.viewDeploymentConfig);
	const [paused, setPaused] = useState(false);
	const [networkFocus, setNetworkFocus] = useState<string | null>(null);
	const [view, setView] = useState<"mine" | "cluster">("mine");
	const cluster = isAdmin && view === "cluster";
	const refetchInterval = paused ? (false as const) : HUD_REFRESH_MS;

	const queryClient = useQueryClient();
	const preferences = useQuery({ ...userUIPreferences(), retry: false });
	const savePreferences = useMutation(updateUserUIPreferences(queryClient));
	const mine = useQuery(quotaMeResources(paused));
	const report = useQuery({
		...quotaReport(),
		refetchInterval,
		enabled: cluster,
	});
	const trend = useQuery({
		...hudHistory("15m"),
		refetchInterval,
		enabled: cluster,
	});
	const drive = useQuery({ ...safe(), refetchInterval });
	const driveSettings = useQuery({
		...cloudDriveSettings(),
		refetchInterval: paused ? false : DRIVE_SETTINGS_REFRESH_MS,
	});
	const running = (mine.data?.workspaces ?? []).filter((w) => w.running);
	const histories = useQueries({
		queries: running.map((w) => ({
			...workspaceResourceHistory(w.id),
			refetchInterval,
		})),
	});
	// Network: the traffic of every running workspace in view, the account's own or, for the whole cluster, all of them.
	const networkTargets = cluster
		? (report.data?.users ?? []).flatMap((u) =>
				u.workspaces
					.filter((w) => w.running)
					.map((w) => ({ id: w.id, name: `${w.owner}/${w.name}` })),
			)
		: running.map((w) => ({ id: w.id, name: w.name }));
	const networks = useQueries({
		queries: networkTargets.map((w) => ({
			...workspaceNetwork(w.id),
			refetchInterval,
		})),
	});

	const scopeQuery = cluster ? report : mine;
	const lastTrend = trend.data?.points.at(-1);
	let scope: DashboardScope | undefined;
	if (cluster) {
		scope = report.data
			? scopeFromCluster(report.data, lastTrend?.diskTotal ?? null)
			: undefined;
	} else {
		scope = mine.data ? scopeFromMine(mine.data) : undefined;
	}
	const limitName = cluster ? "capacity" : "quota";
	// A failed background refresh keeps the last data on screen instead of an error.
	const scopeError = scope ? undefined : scopeQuery.error;
	const live = cluster
		? trend.data
			? liveFromHud(trend.data.points, trend.data.end)
			: null
		: liveFromHistories(histories.map((h) => h.data));
	const readings = (pick: "cpu" | "memory") =>
		cluster
			? []
			: running.map((w, i) => ({
					id: w.id,
					name: w.name,
					value: liveFromHistories([histories[i]?.data])?.[pick].latest ?? null,
				}));
	const disks = new Map<string, DiskReading>(
		cluster
			? []
			: running.map((w, i) => [w.id, diskFromHistory(histories[i]?.data)]),
	);
	// One workspace's traffic when the user picked it (its pill or its row), else everyone's together.
	const focusIndex = networkTargets.findIndex((w) => w.id === networkFocus);
	const network = networkSeries(
		focusIndex === -1
			? networks.map((n) => n.data?.agents)
			: [networks[focusIndex]?.data?.agents],
	);
	// Never a blank card: say why there is no traffic to show.
	const networkEmpty =
		networkTargets.length === 0
			? cluster
				? "No workspace is running in the cluster: traffic shows here while one runs."
				: "None of your workspaces is running: their traffic shows here while one runs."
			: !network &&
				"No traffic readings yet: they appear within a few seconds.";

	const networkPerWorkspace: NetworkReading[] = networkTargets.map((w, i) => {
		const own = networkSeries([networks[i]?.data?.agents]);
		return {
			id: w.id,
			name: w.name,
			rx: own?.rx.latest ?? null,
			tx: own?.tx.latest ?? null,
		};
	});
	const networkLoading = networks.some((n) => n.isLoading);
	const networkError = networks.find((n) => n.error)?.error;
	const gpuWorkspaces = (mine.data?.workspaces ?? []).filter(
		(w) => (w.gpus ?? 0) > 0,
	);
	// The cluster's report has no GPU claims: they are known for the account's own workspaces only.
	const gpus = cluster
		? null
		: gpuWorkspaces.reduce((sum, w) => sum + (w.gpus ?? 0), 0);
	const driveMissing =
		drive.error instanceof PlatformError && drive.error.status === 404;
	const trendLoading =
		scopeQuery.isLoading ||
		(cluster
			? trend.isLoading
			: histories.length > 0 && histories.every((h) => h.isLoading));

	// What each card's resource the account was given: its quota (the cluster's capacity, for the whole cluster).
	const suppliedWhat = cluster ? "Cluster capacity" : "Your quota";
	const supplied = (resource: "cpu" | "memory" | "disk") => {
		const limit = scope ? totalLimit(scope, resource) : null;
		return limit === null || limit === undefined ? undefined : (
			<SuppliedBadge
				value={`${formatQuotaNumber(limit)} ${RESOURCE_UNIT[resource]}`}
				what={suppliedWhat}
			/>
		);
	};
	// The Cloud Drive's connections: every one of the account's own workspaces has it unless disconnected.
	const links = useCloudDriveLinks();
	const ownWorkspaces = mine.data?.workspaces ?? [];
	const driveWorkspaces = links.ready
		? ownWorkspaces.map((w) => ({
				id: w.id,
				label: w.name,
				value: !isLinked(links, w.id)
					? "Disconnected"
					: links.attaching.has(w.id)
						? "Connecting"
						: "Connected",
			}))
		: [];
	const driveConnected = driveWorkspaces.filter(
		(w) => w.value !== "Disconnected",
	).length;
	const driveQuotas = drive.data
		? [
				drive.data.quotaBytes,
				...(drive.data.shared ?? []).map((d) => d.quotaBytes),
			]
		: [];
	const driveCapacity =
		driveQuotas.length > 0 && driveQuotas.every((q) => q !== null)
			? driveQuotas.reduce<number>((sum, q) => sum + (q ?? 0), 0)
			: null;
	const usageCard = (resource: "cpu" | "memory", title: string) => (
		<DashboardCard
			title={title}
			icon={resource === "cpu" ? CpuIcon : MemoryStickIcon}
			tone={resource === "cpu" ? "sky" : "purple"}
			badge={supplied(resource)}
			actions={<RangePill />}
		>
			<CardState
				isLoading={trendLoading}
				error={scopeError ?? (cluster && !live ? trend.error : undefined)}
			>
				{scope && (
					<UsageCardBody
						resource={resource}
						scope={scope}
						series={live?.[resource] ?? null}
						perWorkspace={readings(resource)}
						limitName={limitName}
					/>
				)}
			</CardState>
		</DashboardCard>
	);

	const cardOrder = preferences.data?.dashboard_card_order ?? [];
	const saveCardOrder = (ids: string[]) => {
		// The cards move at once; a failed save puts back what the server has.
		queryClient.setQueryData<UserUIPreferences>(
			userUIPreferences().queryKey,
			(old) => ({ ...old, dashboard_card_order: ids }),
		);
		savePreferences.mutate(
			{ dashboard_card_order: ids },
			{
				onError: (error) => {
					void queryClient.invalidateQueries({
						queryKey: userUIPreferences().queryKey,
					});
					toast.error(
						getErrorMessage(error, "Could not save the cards' order."),
					);
				},
			},
		);
	};

	// Every card after Summary, in the order the user dragged them into (SortableCards).
	const cards: SortableCard[] = [
		{
			id: "workspaces",
			label: "Workspaces",
			node: (
				<DashboardCard
					title="Workspaces"
					icon={MonitorIcon}
					tone="green"
					badge={
						scope?.workspaceLimit != null && (
							<SuppliedBadge
								value={`${scope.workspaceLimit} ${scope.workspaceLimit === 1 ? "workspace" : "workspaces"}`}
								what={suppliedWhat}
							/>
						)
					}
				>
					<CardState
						isLoading={scopeQuery.isLoading}
						error={scopeError}
						empty={
							scope?.workspaces.length === 0 &&
							(cluster
								? "No workspaces in the cluster yet."
								: "You have no workspaces yet. Create one from a template to see its resources here.")
						}
					>
						{scope && (
							<WorkspacesCardBody
								scope={scope}
								me={user.username}
								limitName={limitName}
							/>
						)}
					</CardState>
				</DashboardCard>
			),
		},
		{
			id: "gpu",
			label: "GPU",
			node: (
				// Always there; greyed out while no workspace has a GPU.
				<DashboardCard
					title="GPU"
					icon={CircuitBoardIcon}
					tone="magenta"
					badge={
						!gpus && (
							<SuppliedBadge
								value="N/A"
								what="No workspace has a GPU enabled"
							/>
						)
					}
					muted={!gpus}
				>
					<GpuCardBody
						workspaces={cluster ? [] : gpuWorkspaces}
						known={!cluster}
					/>
				</DashboardCard>
			),
		},
		{
			id: "cloud-drive",
			label: "Cloud Drive",
			node: (
				<DashboardCard
					title="Cloud Drive"
					icon={CloudIcon}
					badge={
						driveCapacity !== null && (
							<SuppliedBadge
								value={formatBytes(driveCapacity)}
								what="Your Cloud Drive's capacity, with the drives shared with you"
							/>
						)
					}
					actions={
						driveWorkspaces.length > 0 && (
							<span
								className="whitespace-nowrap rounded-full border border-solid border-border bg-surface-secondary px-1.5 text-[10px] leading-4 tabular-nums text-content-secondary"
								title="Your workspaces with the Cloud Drive connected, of all your workspaces"
							>
								{driveConnected} of {driveWorkspaces.length} connected
							</span>
						)
					}
				>
					<CardState
						isLoading={drive.isLoading}
						error={driveMissing || drive.data ? undefined : drive.error}
						empty={
							(driveMissing || drive.data?.enabled === false) &&
							"Cloud Drive is not available on this deployment."
						}
					>
						{drive.data && (
							<CloudDriveCardBody
								drive={drive.data}
								settings={driveSettings.data}
								workspaces={driveWorkspaces}
							/>
						)}
					</CardState>
				</DashboardCard>
			),
		},
		{
			id: "memory",
			label: "Memory",
			node: usageCard("memory", "Memory"),
		},
		{
			id: "disks",
			label: "Disks",
			node: (
				<DashboardCard
					title="Disks"
					icon={HardDriveIcon}
					tone="green"
					badge={supplied("disk")}
				>
					<CardState
						isLoading={scopeQuery.isLoading}
						error={scopeError}
						empty={
							scope?.workspaces.length === 0 && "No workspace volumes yet."
						}
					>
						{scope && (
							<DisksCardBody
								scope={scope}
								disks={disks}
								limitName={limitName}
							/>
						)}
					</CardState>
				</DashboardCard>
			),
		},
		{
			id: "processor",
			label: "Processor",
			node: usageCard("cpu", "Processor"),
		},
		{
			id: "network",
			label: "Network",
			node: (
				// Always there: without a running workspace it says so rather than leaving a gap.
				<DashboardCard
					title="Network"
					icon={NetworkIcon}
					tone="orange"
					actions={networkTargets.length > 0 && <RangePill />}
				>
					<CardState
						isLoading={networkTargets.length > 0 && networkLoading && !network}
						error={network ? undefined : networkError}
						empty={networkEmpty}
					>
						{network && (
							<NetworkCardBody
								rx={network.rx}
								tx={network.tx}
								perWorkspace={networkPerWorkspace}
								selected={focusIndex === -1 ? null : networkFocus}
								onSelect={setNetworkFocus}
							/>
						)}
					</CardState>
				</DashboardCard>
			),
		},
	];

	return (
		// The page's card: its corners concentric with the cards inside (their 20px radius plus the 20px between them)
		<div className="min-h-full rounded-[40px] bg-surface-secondary">
			<title>{pageTitle("Dashboard")}</title>
			<div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-5">
				<header className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="m-0 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-content-primary">
						<span
							aria-hidden
							className={cn(
								"size-2 rounded-full",
								paused ? "bg-content-disabled" : "bg-content-success",
							)}
						/>
						Dashboard
					</h1>
					<div className="flex flex-wrap items-center gap-2">
						{isAdmin && (
							<div
								role="group"
								aria-label="Show resources of"
								className="flex gap-1 rounded-full bg-surface-tertiary p-0.5"
							>
								{(
									[
										["mine", "My workspaces"],
										["cluster", "Whole cluster"],
									] as const
								).map(([value, label]) => (
									<Button
										key={value}
										size="sm"
										variant={view === value ? "default" : "subtle"}
										aria-pressed={view === value}
										className="rounded-full"
										onClick={() => setView(value)}
									>
										{label}
									</Button>
								))}
							</div>
						)}
						<Button
							size="sm"
							variant="outline"
							aria-pressed={!paused}
							title={paused ? "Resume live updates" : "Pause live updates"}
							className="rounded-full"
							onClick={() => setPaused(!paused)}
						>
							<span
								aria-hidden
								className={cn(
									"size-2 rounded-full",
									paused
										? "bg-content-disabled"
										: "animate-pulse bg-content-success",
								)}
							/>
							Live
						</Button>
					</div>
				</header>
				{/* The cards flow through as many columns as the window holds (each card kept whole), so the first view fits one
				    screen: Summary first, so it is always the top-left card, and the others packed by height around it. At most
				    four columns, which the cards always fill, so a wide window centres them instead of leaving empty columns on
				    the right. */}
				{/* Cards spaced by their top margins: one at a column's top is dropped at the column break, and none is left
				    below the tallest column, so the parent card's padding stays whole at its top and bottom */}
				<div className="[column-gap:16px] [columns:20rem_4] [&>*]:mt-4 [&>*:first-child]:mt-0 [&>*]:break-inside-avoid">
					<DashboardCard
						title="Summary"
						icon={GaugeIcon}
						tone="purple"
						actions={
							scope?.exempt && (
								<span
									title="Your account is exempt from the quota; the limits are shown for reference."
									className="whitespace-nowrap rounded-full bg-surface-green px-2 text-[11px] font-semibold leading-5 text-content-success"
								>
									Quota Exempt
								</span>
							)
						}
					>
						<CardState isLoading={scopeQuery.isLoading} error={scopeError}>
							{scope && (
								<SummaryCardBody
									scope={scope}
									limitName={limitName}
									gpus={gpus}
									live={{
										cpu: live?.cpu.latest ?? null,
										memory: live?.memory.latest ?? null,
									}}
								/>
							)}
						</CardState>
					</DashboardCard>
					<SortableCards
						cards={orderCards(cards, cardOrder)}
						onReorder={saveCardOrder}
					/>
				</div>
			</div>
		</div>
	);
};

export default DashboardPage;
