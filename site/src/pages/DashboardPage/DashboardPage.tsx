import { cn } from "cn";
import { useState } from "react";
import { useQueries, useQuery } from "react-query";
import { PlatformError } from "#/api/platform";
import {
	cloudDriveSettings,
	HUD_REFRESH_MS,
	hudHistory,
	quotaMeResources,
	quotaReport,
	safe,
	workspaceNetwork,
	workspaceResourceHistory,
} from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { pageTitle } from "#/utils/page";
import { CardState, DashboardCard, RangePill } from "./DashboardCard";
import {
	type DashboardScope,
	diskFromHistory,
	liveFromHistories,
	liveFromHud,
	networkSeries,
	scopeFromCluster,
	scopeFromMine,
} from "./dashboardModel";
import {
	NetworkCardBody,
	type NetworkReading,
	UsageCardBody,
} from "./LiveCards";
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
	const [view, setView] = useState<"mine" | "cluster">("mine");
	const cluster = isAdmin && view === "cluster";
	const refetchInterval = paused ? (false as const) : HUD_REFRESH_MS;

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
	const network = networkSeries(networks.map((n) => n.data?.agents));
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
	const driveMissing =
		drive.error instanceof PlatformError && drive.error.status === 404;
	const trendLoading =
		scopeQuery.isLoading ||
		(cluster
			? trend.isLoading
			: histories.length > 0 && histories.every((h) => h.isLoading));

	const usageCard = (resource: "cpu" | "memory", title: string) => (
		<DashboardCard title={title} actions={<RangePill />}>
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

	return (
		<div className="min-h-full bg-surface-secondary">
			<title>{pageTitle("Dashboard")}</title>
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 py-5 md:px-6">
				<header className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="m-0 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-content-primary">
						<span
							aria-hidden
							className={cn(
								"size-2 rounded-full",
								paused
									? "bg-content-disabled"
									: "animate-pulse bg-content-success",
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
									paused ? "bg-content-disabled" : "bg-content-success",
								)}
							/>
							Live
						</Button>
					</div>
				</header>
				{/* The cards flow through as many columns as the window holds (each card kept whole), so the first view fits one
				    screen: Summary first, so it is always the top-left card, and the others packed by height around it. */}
				<div className="[column-gap:16px] [column-width:20rem] [&>*]:mb-4 [&>*]:break-inside-avoid">
					<DashboardCard title="Summary">
						<CardState isLoading={scopeQuery.isLoading} error={scopeError}>
							{scope && (
								<SummaryCardBody
									scope={scope}
									limitName={limitName}
									live={{
										cpu: live?.cpu.latest ?? null,
										memory: live?.memory.latest ?? null,
									}}
								/>
							)}
						</CardState>
					</DashboardCard>
					<DashboardCard title="Workspaces">
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
					{!cluster && gpuWorkspaces.length > 0 && (
						<DashboardCard title="GPU">
							<GpuCardBody workspaces={gpuWorkspaces} />
						</DashboardCard>
					)}
					<DashboardCard title="Cloud Drive">
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
								/>
							)}
						</CardState>
					</DashboardCard>
					{usageCard("memory", "Memory")}
					<DashboardCard title="Disks">
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
					{usageCard("cpu", "Processor")}
					{networkTargets.length > 0 && (
						<DashboardCard title="Network" actions={<RangePill />}>
							<CardState
								isLoading={networkLoading && !network}
								error={network ? undefined : networkError}
							>
								{network && (
									<NetworkCardBody
										rx={network.rx}
										tx={network.tx}
										perWorkspace={networkPerWorkspace}
									/>
								)}
							</CardState>
						</DashboardCard>
					)}
				</div>
			</div>
		</div>
	);
};

export default DashboardPage;
