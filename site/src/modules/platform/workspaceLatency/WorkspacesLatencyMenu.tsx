import { cn } from "cn";
import { MonitorIcon, TimerIcon } from "lucide-react";
import { useQuery } from "react-query";
import { Link } from "react-router";
import { workspaces } from "#/api/queries/workspaces";
import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";
import {
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { getLatencyColor } from "#/utils/latency";

/** How often the list asks again while the menu is open. */
export const REFRESH_MS = 3000;

/** An agent's latency as the workspace page shows it: its preferred region's, else the first. */
export const agentLatency = (agent: WorkspaceAgent): number | undefined => {
	const regions = Object.values(agent.latency ?? {});
	return (regions.find((r) => r.preferred) ?? regions[0])?.latency_ms;
};

/** A workspace's: its agents' best (a running workspace whose agents report none yet: undefined). */
export const workspaceLatency = (workspace: Workspace): number | undefined => {
	const values = workspace.latest_build.resources
		.flatMap((r) => r.agents ?? [])
		.map(agentLatency)
		.filter((v): v is number => typeof v === "number");
	return values.length ? Math.min(...values) : undefined;
};

/**
 * The navigation bar's latency menu (ProxyMenu): a Workspaces item whose menu lists each of the signed-in user's
 * workspaces with the latency to it - its agent's, as on its page (the stopwatch) - asked again every few seconds
 * while the menu is open; one that is not running says so. A workspace opens its page.
 */
export const WorkspacesLatencyMenu: React.FC<{ open: boolean }> = ({
	open,
}) => {
	const query = useQuery({
		...workspaces({ q: "owner:me" }),
		enabled: open,
		refetchInterval: open ? REFRESH_MS : false,
	});
	const list = query.data?.workspaces ?? [];
	const running = list.filter((w) => w.latest_build.status === "running");

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger data-testid="workspaces-latency">
				<MonitorIcon aria-hidden className="size-4" />
				Workspaces
				<span className="ml-auto pr-1 text-xs text-content-secondary tabular-nums">
					{query.data ? `${running.length} running` : ""}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent
				className="w-72"
				data-testid="workspaces-latency-list"
			>
				<DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-content-secondary">
					<TimerIcon aria-hidden className="size-3.5" />
					Latency to your workspaces, live
				</DropdownMenuLabel>
				{query.isLoading && (
					<DropdownMenuItem disabled>Loading…</DropdownMenuItem>
				)}
				{query.data && list.length === 0 && (
					<DropdownMenuItem disabled>No workspaces</DropdownMenuItem>
				)}
				{list.map((w) => {
					const up = w.latest_build.status === "running";
					const ms = up ? workspaceLatency(w) : undefined;
					return (
						<DropdownMenuItem key={w.id} asChild>
							<Link
								to={`/@${w.owner_name}/${w.name}`}
								data-testid={`workspace-latency-${w.name}`}
								className="flex items-center gap-2"
							>
								<span
									aria-hidden
									className={cn(
										"size-2 shrink-0 rounded-full",
										up ? "bg-content-success" : "bg-content-disabled",
									)}
								/>
								<span
									className={cn("truncate", !up && "text-content-secondary")}
								>
									{w.name}
								</span>
								<span
									className={cn(
										"ml-auto shrink-0 text-xs tabular-nums",
										up ? getLatencyColor(ms) : "text-content-secondary",
									)}
								>
									{!up
										? w.latest_build.status
										: ms === undefined
											? "…"
											: `${Math.round(ms)}ms`}
								</span>
							</Link>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
};
