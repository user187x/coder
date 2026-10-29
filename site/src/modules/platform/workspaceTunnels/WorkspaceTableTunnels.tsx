import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQueries } from "react-query";
import type { WorkspaceTunnel } from "#/api/platform";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import type { Workspace } from "#/api/typesGenerated";
import { TunnelFlowIndicator } from "./TunnelFlowIndicator";
import { TunnelOverviewTooltip } from "./TunnelOverview";
import {
	type TableTunnelAnchor,
	type TunnelManagerActions,
	WorkspaceTunnelPorts,
} from "./WorkspaceTunnelPorts";

const Connections = createContext<{
	tunnels: WorkspaceTunnel[];
	unavailable: boolean;
	shownIds: string[];
	openManager: (workspaceId: string) => void;
}>({ tunnels: [], unavailable: false, shownIds: [], openManager: () => {} });

/** Keep table cords anchored to visible rows as sorting, scrolling and row sizes change. */
export const WorkspaceTableTunnels: React.FC<{
	shown: readonly Workspace[];
	canManage: boolean;
	actorId?: string;
	children: React.ReactNode;
}> = ({ shown, canManage, actorId, children }) => {
	const area = useRef<HTMLDivElement>(null);
	const managerRef = useRef<TunnelManagerActions>(null);
	const [anchors, setAnchors] = useState<TableTunnelAnchor[]>([]);
	const organizations = [...new Set(shown.map((w) => w.organization_id))];
	const results = useQueries({ queries: organizations.map(workspaceTunnels) });
	const tunnels = results.flatMap((r) => r.data?.tunnels ?? []);
	const unavailable = results.some((r) => r.isError);
	useEffect(() => {
		const root = area.current;
		if (!root) return;
		let frame = 0;
		const measure = () => {
			const origin = root.getBoundingClientRect();
			const next = Array.from(
				root.querySelectorAll<HTMLElement>("[data-workspace-tunnel-row]"),
			).map((row) => {
				const box = row.getBoundingClientRect();
				const edge =
					row.closest(".table-card")?.getBoundingClientRect().left ?? box.left;
				return {
					workspaceId: row.dataset.workspaceTunnelRow ?? "",
					x: edge - origin.left - 15,
					y: box.top - origin.top + box.height / 2,
				};
			});
			setAnchors((previous) =>
				JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
			);
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(root);
		for (const row of root.querySelectorAll("[data-workspace-tunnel-row]"))
			observer.observe(row);
		root.addEventListener("scroll", schedule, true);
		window.addEventListener("resize", schedule);
		measure();
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			root.removeEventListener("scroll", schedule, true);
			window.removeEventListener("resize", schedule);
		};
	}, [shown]);
	return (
		<Connections.Provider
			value={{
				tunnels,
				unavailable,
				shownIds: shown.map((w) => w.id),
				openManager: (id) => managerRef.current?.open(id),
			}}
		>
			<div ref={area} className="relative min-w-0">
				{children}
				<WorkspaceTunnelPorts
					managerRef={managerRef}
					key={actorId}
					shown={shown}
					cols={1}
					cellW={0}
					cellH={0}
					gap={0}
					tableAnchors={anchors}
					canManage={canManage && !unavailable}
					actorId={unavailable ? undefined : actorId}
					onDragging={() => {}}
				/>
			</div>
		</Connections.Provider>
	);
};

/** Only backend-reported transitions blink; connection completion is never inferred from a request response. */
export const WorkspaceTunnelStatus: React.FC<{ workspaceId: string }> = ({
	workspaceId,
}) => {
	const { tunnels, unavailable, shownIds, openManager } =
		useContext(Connections);
	const affected = tunnels.filter(
		(t) =>
			t.source_workspace_id === workspaceId ||
			t.target_workspace_id === workspaceId,
	);
	if (!affected.length) return null;
	const outside = affected.filter(
		(t) =>
			!shownIds.includes(t.source_workspace_id) ||
			!shownIds.includes(t.target_workspace_id),
	).length;
	const removing = affected.some((t) => t.status === "disconnecting");
	const pending = affected.some((t) => t.status === "pending");
	const error = affected.some((t) => t.status === "error");
	const label = unavailable
		? "Tunnel status unavailable"
		: removing
			? "Decommissioning tunnel"
			: pending
				? "Establishing tunnel"
				: error
					? "Tunnel error"
					: `${affected.length} tunnel${affected.length === 1 ? "" : "s"} connected`;
	const ready = unavailable ? [] : affected.filter((t) => t.status === "ready");
	const incoming = ready.filter(
		(t) => t.target_workspace_id === workspaceId,
	).length;
	const outgoing = ready.filter(
		(t) => t.source_workspace_id === workspaceId,
	).length;
	const summary = `${label}${outside > 0 ? ` · ${outside} outside this view` : ""}. ${incoming} incoming, ${outgoing} outgoing`;
	return (
		<TunnelOverviewTooltip
			overview={
				<div className="flex flex-col gap-2">
					<p className="m-0 font-semibold text-content-primary">
						Workspace tunnels
					</p>
					<p className="m-0">
						{label}
						{outside > 0 && ` · ${outside} outside this view`}
					</p>
					<div className="flex justify-between gap-3">
						<span className="text-[#94a3b8]">{outgoing} outgoing →</span>
						<span className="text-[#4ade80]">{incoming} incoming ←</span>
					</div>
					{affected.map((t) => (
						<div
							key={t.id}
							className="border-0 border-t border-solid border-border pt-2"
						>
							<p className="m-0 break-all text-content-primary">
								{t.source_workspace_name ?? t.source_workspace_id} →{" "}
								{t.target_workspace_name ?? t.target_workspace_id}
							</p>
							<p className="m-0">{t.error || t.status}</p>
						</div>
					))}
				</div>
			}
		>
			<button
				type="button"
				aria-label={summary}
				onClick={(e) => {
					e.stopPropagation();
					openManager(workspaceId);
				}}
				className="mt-1 inline-flex cursor-pointer items-center border-0 bg-transparent p-0 text-content-secondary"
			>
				<TunnelFlowIndicator incoming={incoming} outgoing={outgoing} />
				<span role="status" className="sr-only">
					{summary}
				</span>
			</button>
		</TunnelOverviewTooltip>
	);
};
