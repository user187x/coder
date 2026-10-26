import type { ReactElement, ReactNode } from "react";
import type { WorkspaceTunnel } from "#/api/platform";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";

/** Shares the endpoint overview between visible plugs and off-screen cable heads. */
export const TunnelOverview = ({
	tunnel,
	peerSource,
}: {
	tunnel: WorkspaceTunnel;
	peerSource: boolean;
}) => {
	const name = peerSource
		? (tunnel.source_workspace_name ?? tunnel.source_workspace_id)
		: (tunnel.target_workspace_name ?? tunnel.target_workspace_id);
	const address = peerSource ? tunnel.source_address : tunnel.target_address;
	const stats = peerSource ? tunnel.source_stats : tunnel.target_stats;
	return (
		<div className="flex flex-col gap-2">
			<p className="m-0 flex items-center justify-between gap-3 font-semibold text-content-primary">
				<span>Workspace tunnel</span>
				<span className="text-content-link">{tunnel.status}</span>
			</p>
			<p className="m-0 break-all text-sm font-semibold text-content-primary">
				{name}
			</p>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
				<dt>Source</dt>
				<dd className="m-0 break-all">
					{tunnel.source_workspace_name ?? tunnel.source_workspace_id}
				</dd>
				<dt>Destination</dt>
				<dd className="m-0 break-all">
					{tunnel.target_workspace_name ?? tunnel.target_workspace_id}
				</dd>
				<dt>Address / IP</dt>
				<dd className="m-0 break-all font-mono">{address || "Not reported"}</dd>
				<dt>Allowed ports</dt>
				<dd className="m-0 break-all">
					{tunnel.ports
						? tunnel.ports
								.map((p) => `${p.protocol.toUpperCase()} ${p.port}`)
								.join(", ") || "None"
						: "All ports"}
				</dd>
				<dt>Observed ports</dt>
				<dd className="m-0 break-all">
					{stats?.ports_available
						? stats.ports
								.map(
									(p) =>
										`${p.protocol.toUpperCase()} ${p.local_port} → ${p.remote_port}`,
								)
								.join(", ") || "None observed"
						: "Not reported"}
				</dd>
			</dl>
			<p className="m-0 border-0 border-t border-solid border-border pt-2 text-content-secondary">
				Click for connection controls. Ctrl+drag the free head or cable to
				adjust routing.
			</p>
			{stats?.stale && (
				<p className="m-0 text-content-warning">Port observations are stale.</p>
			)}
			{tunnel.error && (
				<p className="m-0 text-content-destructive">{tunnel.error}</p>
			)}
		</div>
	);
};

/** Provides a keyboard-accessible hover card without changing click or drag behavior. */
export const TunnelOverviewTooltip = ({
	overview,
	children,
}: {
	overview?: ReactNode;
	children: ReactElement;
}) =>
	overview ? (
		<TooltipProvider delayDuration={100}>
			<Tooltip>
				<TooltipTrigger asChild>{children}</TooltipTrigger>
				<TooltipContent
					side="right"
					className="z-[100] w-80 max-w-[calc(100vw-2rem)] px-3 py-2.5"
				>
					{overview}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	) : (
		children
	);
