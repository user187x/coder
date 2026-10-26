import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQueries } from "react-query";
import type { WorkspaceTunnel } from "#/api/platform";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import type { Workspace } from "#/api/typesGenerated";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import {
	type TableTunnelAnchor,
	WorkspaceTunnelPorts,
} from "./WorkspaceTunnelPorts";

const Connections = createContext<{
	tunnels: WorkspaceTunnel[];
	unavailable: boolean;
	shownIds: string[];
}>({ tunnels: [], unavailable: false, shownIds: [] });

/** Keep table cords anchored to visible rows as sorting, scrolling and row sizes change. */
export const WorkspaceTableTunnels: React.FC<{
	shown: readonly Workspace[];
	canManage: boolean;
	actorId?: string;
	children: React.ReactNode;
}> = ({ shown, canManage, actorId, children }) => {
	const area = useRef<HTMLDivElement>(null);
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
			value={{ tunnels, unavailable, shownIds: shown.map((w) => w.id) }}
		>
			<div ref={area} className="relative min-w-0">
				{children}
				<WorkspaceTunnelPorts
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
	const { tunnels, unavailable, shownIds } = useContext(Connections);
	const animations = useAnimationsEnabled();
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
	return (
		<span
			role="status"
			title={
				affected
					.map((t) => t.error)
					.filter(Boolean)
					.join("; ") || undefined
			}
			className="mt-1 inline-flex items-start gap-1 text-[10px] leading-[15px] text-content-secondary"
		>
			<span
				aria-hidden
				className={`mt-1 size-1.5 shrink-0 rounded-full ${unavailable || error ? "bg-content-destructive" : pending || removing ? "bg-content-warning" : "bg-content-success"} ${animations && (pending || removing) ? "motion-safe:animate-pulse" : ""}`}
			/>
			<span>
				{label}
				{outside > 0 && ` · ${outside} outside this view`}
			</span>
		</span>
	);
};
