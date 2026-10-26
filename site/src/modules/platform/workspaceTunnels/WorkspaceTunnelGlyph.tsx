import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "react-query";
import type { WorkspaceTunnel } from "#/api/platform";
import { workspaces } from "#/api/queries/workspaces";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import type { Workspace } from "#/api/typesGenerated";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import "./workspaceTunnels.css";
import {
	NetworkHistogram,
	type NetworkSample,
} from "../networkLeds/NetworkHistogram";

/** Resolves the remote peer and traffic observed at the current workspace. */
export const workspaceTunnelPeer = (
	tunnel: WorkspaceTunnel,
	workspaceId: string,
	known: readonly Workspace[],
) => {
	const source = tunnel.source_workspace_id === workspaceId;
	const id = source ? tunnel.target_workspace_id : tunnel.source_workspace_id;
	return {
		id,
		name:
			(source ? tunnel.target_workspace_name : tunnel.source_workspace_name) ||
			known.find((w) => w.id === id)?.name ||
			`Workspace ${id.slice(0, 8)}`,
		address: source ? tunnel.target_address : tunnel.source_address,
		stats: source ? tunnel.source_stats : tunnel.target_stats,
	};
};

/** Displays only connections acknowledged by both workspace networking helpers. */
export const WorkspaceTunnelGlyph: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const [open, setOpen] = useState(false);
	const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const contentId = useId();
	const query = useQuery(workspaceTunnels(workspace.organization_id));
	const tunnels =
		query.data?.tunnels.filter(
			(t) =>
				t.status === "ready" &&
				(t.source_workspace_id === workspace.id ||
					t.target_workspace_id === workspace.id),
		) ?? [];
	const peers = useQuery({
		...workspaces({ q: "owner:me" }),
		enabled:
			open &&
			tunnels.length > 0 &&
			tunnels.some((t) => !t.source_workspace_name || !t.target_workspace_name),
	});
	useEffect(() => () => clearTimeout(closeTimer.current), []);
	const show = () => {
		clearTimeout(closeTimer.current);
		setOpen(true);
	};
	const leave = () => {
		clearTimeout(closeTimer.current);
		closeTimer.current = setTimeout(() => setOpen(false), 150);
	};
	if (query.isError || tunnels.length === 0) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="workspace-tunnel-status flex size-5 cursor-pointer items-center justify-center rounded-full border-0 bg-surface-tertiary p-0"
					aria-label={`Workspace tunnels: ${tunnels.length} connected`}
					aria-controls={open ? contentId : undefined}
					onMouseEnter={show}
					onMouseLeave={leave}
					onFocus={show}
					onClick={(e) => {
						e.preventDefault();
						show();
					}}
				>
					<span
						aria-hidden
						className="workspace-tunnel-icon size-4 text-content-secondary"
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent
				id={contentId}
				side="bottom"
				align="end"
				className="z-[95] w-[350px] max-w-[calc(100vw-32px)] p-3"
				aria-label="Connected workspace tunnels"
				onMouseEnter={show}
				onMouseLeave={leave}
				onOpenAutoFocus={(e) => e.preventDefault()}
				onCloseAutoFocus={(e) => e.preventDefault()}
			>
				<p className="m-0 mb-1 font-semibold">Connected workspace tunnels</p>
				<p className="m-0 mb-3 text-xs text-content-secondary">
					Traffic and ports observed at {workspace.name}.
				</p>
				<div className="flex flex-col gap-4">
					{tunnels.map((t) => {
						const peer = workspaceTunnelPeer(
							t,
							workspace.id,
							peers.data?.workspaces ?? [],
						);
						const stats = peer.stats;
						const series =
							stats?.series
								.filter(
									(s) =>
										Number.isFinite(s.timestamp) &&
										Number.isFinite(s.rx_bytes_per_second) &&
										Number.isFinite(s.tx_bytes_per_second) &&
										s.rx_bytes_per_second >= 0 &&
										s.tx_bytes_per_second >= 0,
								)
								.toSorted((a, b) => a.timestamp - b.timestamp) ?? [];
						const samples: NetworkSample[] = series.map((s, index) => ({
							from: (series[index - 1]?.timestamp ?? s.timestamp) * 1000,
							t: s.timestamp * 1000,
							rx: s.rx_bytes_per_second,
							tx: s.tx_bytes_per_second,
						}));
						const available = stats && !stats.stale && samples.length > 0;
						return (
							<section
								key={t.id}
								aria-label={`Tunnel to ${peer.name}`}
								className="border-0 border-t border-solid border-border pt-3"
							>
								<p className="m-0 text-sm font-medium">
									{peer.name}
									<span className="ml-2 font-mono text-xs text-content-secondary">
										{peer.address ?? "Address unavailable"}
									</span>
								</p>
								{available ? (
									<div className="mt-3">
										<NetworkHistogram samples={samples} />
									</div>
								) : (
									<p className="my-3 text-xs text-content-secondary">
										{stats?.stale
											? "Network telemetry is stale. Waiting for a workspace update."
											: "Waiting for network telemetry. Activity is unavailable."}
									</p>
								)}
								<p className="m-0 mb-1 mt-3 text-xs font-semibold">
									{stats &&
									!stats.stale &&
									!stats.ports_available &&
									stats.ports.length > 0
										? "Observed ports (partial)"
										: "Observed active ports"}
								</p>
								{!stats || stats.stale ? (
									<p className="m-0 text-xs text-content-secondary">
										Active port information is unavailable.
									</p>
								) : stats.ports.length === 0 ? (
									<p className="m-0 text-xs text-content-secondary">
										{stats.ports_available
											? "No active ports observed."
											: "Port observations are unavailable."}
									</p>
								) : (
									<table
										aria-label={`Observed active ports for ${peer.name}`}
										className="w-full text-left text-xs tabular-nums"
									>
										<thead>
											<tr>
												<th className="py-1">Protocol</th>
												<th>Local</th>
												<th>Remote</th>
											</tr>
										</thead>
										<tbody>
											{stats.ports.map((p) => (
												<tr
													key={`${p.protocol}:${p.local_port}:${p.remote_port}`}
												>
													<td className="py-1 uppercase">{p.protocol}</td>
													<td>{p.local_port}</td>
													<td>{p.remote_port}</td>
												</tr>
											))}
										</tbody>
									</table>
								)}
							</section>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
};
