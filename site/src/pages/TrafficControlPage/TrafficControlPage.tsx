import { useMemo, useState } from "react";
import {
	type UseQueryResult,
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "react-query";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import type { WorkspaceTunnel } from "#/api/platform";
import { workspacePortShares } from "#/api/queries/workspaceportsharing";
import {
	agentListeningPorts,
	workspaces as workspacesQuery,
} from "#/api/queries/workspaces";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import type {
	WorkspaceAgentListeningPortsResponse,
	WorkspaceAgentPortShare,
	WorkspaceAgentPortShareLevel,
} from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { pageTitle } from "#/utils/page";
import { type ShareChange, TrafficDiagram } from "./TrafficDiagram";
import {
	type TrafficTopology,
	type TrafficWorkspace,
	trafficTopologies,
	tunnelRate,
} from "./trafficModel";

const WORKSPACES_REFRESH_MS = 10_000;
const OPEN_PORTS_REFRESH_MS = 10_000;

/** Every agent's listening ports of one workspace, each port once. */
const combineOpenPorts = (
	results: UseQueryResult<WorkspaceAgentListeningPortsResponse>[],
) => ({
	ports: [
		...new Set(
			results.flatMap((r) => (r.data?.ports ?? []).map((p) => p.port)),
		),
	].sort((a, b) => a - b),
	loading: results.some((r) => r.isLoading),
	failed: results.length > 0 && results.every((r) => r.error),
});

/** The pill under the tunnels one: how many ports the workspace clicked on has open. */
const OpenPortsPill: React.FC<{
	workspace: TrafficWorkspace;
	/** The ports its owner shared: open through Coder even before anything listens on them. */
	shared: readonly number[];
}> = ({ workspace, shared }) => {
	const open = useQueries({
		queries: workspace.running
			? workspace.agentIds.map((id) => ({
					...agentListeningPorts(id),
					refetchInterval: OPEN_PORTS_REFRESH_MS,
				}))
			: [],
		combine: combineOpenPorts,
	});
	// Each port once: what its agents listen on, and what is shared.
	const ports = [...new Set([...open.ports, ...shared])].sort((a, b) => a - b);
	const text = !workspace.running
		? "not running"
		: open.loading
			? "counting open ports…"
			: open.failed
				? "open ports unavailable"
				: `${ports.length} open ${ports.length === 1 ? "port" : "ports"}`;
	return (
		<span
			role="status"
			aria-label={`${workspace.label}: ${text}`}
			title={ports.length ? `Open: ${ports.join(", ")}` : undefined}
			className="whitespace-nowrap rounded-full border border-solid border-content-link/60 bg-surface-secondary px-2 text-[11px] leading-5 tabular-nums text-content-secondary"
		>
			<span className="font-medium text-content-primary">
				{workspace.label}
			</span>{" "}
			· {text}
		</span>
	);
};
const SHARES_REFRESH_MS = 15_000;

/** Every organization's tunnels in one list (useQueries' combine: kept stable, so its result is too). */
const combineTunnels = (
	results: UseQueryResult<{ tunnels: WorkspaceTunnel[] }>[],
) => ({
	tunnels: results.flatMap((r) => r.data?.tunnels ?? []),
	error: results.find((r) => r.error)?.error,
});

/** Every running workspace's shared ports in one list. */
const combineShares = (
	results: UseQueryResult<{ shares: readonly WorkspaceAgentPortShare[] }>[],
) => results.flatMap((r) => r.data?.shares ?? []);

const Legend: React.FC = () => (
	<ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0 text-xs text-content-secondary">
		<li className="flex items-center gap-1.5">
			<span
				aria-hidden
				className="size-2.5 rounded-full border border-solid border-[#4f9aa6] bg-[#75bdca]"
			/>
			Input ports: shared ports
		</li>
		<li className="flex items-center gap-1.5">
			<span
				aria-hidden
				className="size-2.5 rounded-full border border-solid border-content-link bg-content-link/70"
			/>
			Workspaces
		</li>
		<li className="flex items-center gap-1.5">
			<span
				aria-hidden
				className="size-2.5 rounded-full border border-solid border-[#8a9a46] bg-[#cfe17a]"
			/>
			Output ports: tunnel ports to another workspace
		</li>
		<li className="flex items-center gap-1.5">
			<span aria-hidden className="size-2 rounded-full bg-[#ec4899]" />
			Traffic out
			<span aria-hidden className="ml-1 size-2 rounded-full bg-[#38bdf8]" />
			back
		</li>
		<li className="flex items-center gap-1.5">
			<span
				aria-hidden
				className="w-4 border-0 border-t-2 border-dashed border-content-secondary"
			/>
			Not connected yet
		</li>
	</ul>
);

const TopologyCard: React.FC<{
	topology: TrafficTopology;
	rates: ReadonlyMap<string, ReturnType<typeof tunnelRate>>;
	onShareChange: ShareChange;
}> = ({ topology, rates, onShareChange }) => {
	const [selected, setSelected] = useState<string | null>(null);
	const picked = topology.columns
		.flatMap((c) => (c.kind === "workspace" ? c.workspaces : []))
		.find((w) => w.id === selected);
	const count = (kind: "input" | "output") =>
		topology.columns.reduce(
			(n, c) =>
				c.kind === "workspace"
					? n
					: n + c.orbs.filter((o) => o.kind === kind).length,
			0,
		);
	const workspaces = topology.columns.reduce(
		(n, c) => (c.kind === "workspace" ? n + c.workspaces.length : n),
		0,
	);
	const ready = topology.tunnels.filter((t) => t.status === "ready").length;
	return (
		<section
			aria-label={topology.title}
			className="rounded-[20px] border border-solid border-border bg-surface-primary px-5 py-4 shadow-sm"
		>
			<header className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<h2 className="m-0 truncate text-[13px] font-bold uppercase tracking-wide text-content-primary">
					{topology.title}
				</h2>
				<div className="flex flex-col items-end gap-1">
					{topology.tunnels.length > 0 && (
						<span className="whitespace-nowrap rounded-full border border-solid border-border bg-surface-secondary px-2 text-[11px] leading-5 tabular-nums text-content-secondary">
							{ready} of {topology.tunnels.length}{" "}
							{topology.tunnels.length === 1 ? "tunnel" : "tunnels"} connected
						</span>
					)}
					{picked && (
						<OpenPortsPill
							workspace={picked}
							shared={topology.columns.flatMap((c) =>
								c.kind === "workspace"
									? []
									: c.orbs.flatMap((o) =>
											o.share?.workspace_id === picked.id ? [o.share.port] : [],
										),
							)}
						/>
					)}
				</div>
			</header>
			<div className="flex justify-center overflow-x-auto py-2">
				<TrafficDiagram
					topology={topology}
					rates={rates}
					selected={picked ? picked.id : null}
					onSelect={setSelected}
					onShareChange={onShareChange}
				/>
			</div>
			<footer className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-0 border-t border-solid border-border pt-3 text-xs text-content-secondary">
				<span>
					Input ports:{" "}
					<strong className="text-content-primary">{count("input")}</strong>
				</span>
				<span>
					Workspaces:{" "}
					<strong className="text-content-primary">{workspaces}</strong>
				</span>
				<span>
					Output ports:{" "}
					<strong className="text-content-primary">{count("output")}</strong>
				</span>
				<span>
					Links:{" "}
					<strong className="text-content-primary">
						{topology.links.length}
					</strong>
				</span>
			</footer>
		</section>
	);
};

/**
 * Traffic Control: how the workspaces in view reach each other and are reached. Each workspace's shared ports come
 * in on the left, its tunnels to other workspaces go out through their ports to the right, and live traffic runs
 * along them. Everything here follows the workspaces' own configuration; it has no controls of its own. Admins can
 * switch from their own workspaces to the whole cluster.
 */
const TrafficControlPage: React.FC = () => {
	const { permissions } = useAuthenticated();
	const isAdmin = Boolean(permissions.viewDeploymentConfig);
	const [view, setView] = useState<"mine" | "cluster">("mine");
	const cluster = isAdmin && view === "cluster";

	const list = useQuery({
		...workspacesQuery({ q: cluster ? "" : "owner:me" }),
		refetchInterval: WORKSPACES_REFRESH_MS,
	});
	const all = list.data?.workspaces ?? [];
	const organizations = [...new Set(all.map((w) => w.organization_id))];
	const tunnelResult = useQueries({
		queries: organizations.map((id) => workspaceTunnels(id)),
		combine: combineTunnels,
	});
	const running = all.filter((w) => w.latest_build.status === "running");
	const shareList = useQueries({
		queries: running.map((w) => ({
			...workspacePortShares(w.id),
			refetchInterval: SHARES_REFRESH_MS,
		})),
		combine: combineShares,
	});

	const topologies = useMemo(() => {
		const workspaces: TrafficWorkspace[] = (list.data?.workspaces ?? []).map(
			(w) => ({
				id: w.id,
				label: cluster ? `${w.owner_name}/${w.name}` : w.name,
				running: w.latest_build.status === "running",
				offline:
					w.latest_build.status === "running" &&
					!w.latest_build.resources.some((res) =>
						(res.agents ?? []).some((a) => a.status === "connected"),
					),
				href: `/@${encodeURIComponent(w.owner_name)}/${encodeURIComponent(w.name)}`,
				agentIds: w.latest_build.resources.flatMap((res) =>
					(res.agents ?? []).map((a) => a.id),
				),
			}),
		);
		const shares = new Map<string, WorkspaceAgentPortShare[]>();
		for (const share of shareList) {
			shares.set(share.workspace_id, [
				...(shares.get(share.workspace_id) ?? []),
				share,
			]);
		}
		return trafficTopologies(workspaces, tunnelResult.tunnels, shares);
	}, [list.data, cluster, tunnelResult.tunnels, shareList]);
	const rates = new Map(
		tunnelResult.tunnels.map((t) => [t.id, tunnelRate(t)] as const),
	);
	const tunnelError = tunnelResult.error;
	const queryClient = useQueryClient();
	const changeShare = useMutation({
		mutationFn: ({
			share,
			level,
		}: {
			share: WorkspaceAgentPortShare;
			level: WorkspaceAgentPortShareLevel | null;
		}) =>
			level
				? API.upsertWorkspaceAgentSharedPort(share.workspace_id, {
						agent_name: share.agent_name,
						port: share.port,
						protocol: share.protocol,
						share_level: level,
					})
				: API.deleteWorkspaceAgentSharedPort(share.workspace_id, {
						agent_name: share.agent_name,
						port: share.port,
					}),
		onSuccess: (_result, { share, level }) => {
			toast.success(
				level
					? `Port ${share.port} is now shared with ${level === "owner" ? "its owner only" : level === "organization" ? "the organization" : "signed-in users"}.`
					: `Port ${share.port} is no longer shared.`,
			);
			return queryClient.invalidateQueries({
				queryKey: workspacePortShares(share.workspace_id).queryKey,
			});
		},
		onError: (error, { share }) =>
			toast.error(
				getErrorMessage(error, `Port ${share.port} could not be changed.`),
			),
	});
	const onShareChange: ShareChange = (orb, level) => {
		if (orb.share) {
			changeShare.mutate({ share: orb.share, level });
		}
	};

	return (
		<div className="min-h-full bg-surface-secondary">
			<title>{pageTitle("Traffic Control")}</title>
			<div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-5 md:px-6">
				<header className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="m-0 text-sm font-bold uppercase tracking-wide text-content-primary">
						Traffic Control
					</h1>
					{isAdmin && (
						<div
							role="group"
							aria-label="Show traffic of"
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
				</header>
				<Legend />
				{list.error ? (
					<ErrorAlert error={list.error} />
				) : list.isLoading ? (
					<div aria-busy className="flex flex-col gap-3">
						<Skeleton className="h-72 w-full rounded-[20px]" />
					</div>
				) : topologies.length === 0 ? (
					<p className="m-0 rounded-[20px] border border-solid border-border bg-surface-primary px-5 py-8 text-center text-sm text-content-secondary">
						{cluster
							? "No workspaces in the cluster yet."
							: "You have no workspaces yet. Their shared ports and tunnels show here once you create one."}
					</p>
				) : (
					<>
						{tunnelError ? <ErrorAlert error={tunnelError} /> : null}
						<div className="flex flex-col gap-4">
							{topologies.map((topology) => (
								<TopologyCard
									key={topology.key}
									topology={topology}
									rates={rates}
									onShareChange={onShareChange}
								/>
							))}
						</div>
					</>
				)}
				<p className="m-0 text-xs text-content-secondary">
					Shared ports and tunnels come from each workspace's own settings
					(Ports and Tunnels on its page).
				</p>
			</div>
		</div>
	);
};

export default TrafficControlPage;
