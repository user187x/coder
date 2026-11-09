import { cn } from "cn";
import { MonitorIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { WorkspaceAgentPortShareLevel } from "#/api/typesGenerated";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { useAnimationsEnabled } from "#/hooks/useAnimationSettings";
import type {
	PortOrb,
	TrafficColumn,
	TrafficTopology,
	TunnelRate,
} from "./trafficModel";

const MARGIN = 40;
const GAP = 90;
const PORT_W = 124;
const WS_W = 220;
const TOP = 44;
const LABEL_H = 56;
const DOT_R = 24;

/** The orbs' and columns' colours, as in the tunnel visualizer: blue in, green out, pink workspaces. */
const PALETTE = {
	input: {
		fill: "#75bdca",
		stroke: "#4f9aa6",
		text: "#0f2e33",
		tag: "#1c4c54",
	},
	output: {
		fill: "#cfe17a",
		stroke: "#8a9a46",
		text: "#283011",
		tag: "#434f20",
	},
	active: "#dc352e",
	forward: "#ec4899",
	back: "#38bdf8",
} as const;

/**
 * The workspaces in the theme's own colour (its accent, --content-link), a shade of it for each part: the box's
 * border the colour itself, the name a lighter tint, the orb shaded from a light tint to a darker shade.
 */
const WORKSPACE = {
	border: "hsl(var(--content-link))",
	text: "color-mix(in srgb, hsl(var(--content-link)) 70%, white)",
	orbLight: "color-mix(in srgb, hsl(var(--content-link)) 50%, white)",
	orb: "hsl(var(--content-link))",
	orbDark: "color-mix(in srgb, hsl(var(--content-link)) 70%, black)",
	halo: "hsl(var(--content-link) / 0.22)",
	glow: "drop-shadow(0 0 12px hsl(var(--content-link) / 0.7))",
} as const;

type Point = { x: number; y: number; r: number; workspace: boolean };

type Placed = {
	column: TrafficColumn;
	x: number;
	w: number;
	top: number;
	h: number;
};

const columnHeight = (column: TrafficColumn) =>
	column.kind === "workspace"
		? Math.max(220, column.workspaces.length * 120 + 40)
		: Math.max(220, column.orbs.length * 96 + 36);

/** Where every column, orb and workspace sits; the diagram's size. */
const layout = (topology: TrafficTopology) => {
	const height = Math.max(...topology.columns.map(columnHeight));
	const centre = TOP + height / 2;
	const nodes = new Map<string, Point>();
	const placed: Placed[] = [];
	let x = MARGIN;
	for (const column of topology.columns) {
		const w = column.kind === "workspace" ? WS_W : PORT_W;
		const h = columnHeight(column);
		const top = centre - h / 2;
		const cx = x + w / 2;
		if (column.kind === "workspace") {
			const k = column.workspaces.length;
			const pad = DOT_R + 30;
			const step = k > 1 ? (h - 2 * pad) / (k - 1) : 0;
			column.workspaces.forEach((ws, i) => {
				nodes.set(ws.id, {
					x: cx,
					y: k > 1 ? top + pad + i * step : centre,
					r: DOT_R,
					workspace: true,
				});
			});
		} else {
			const n = column.orbs.length;
			const available = h - 34;
			const r =
				n === 1 ? 40 : Math.max(15, Math.min(40, (available / n) * 0.4));
			const step = n > 1 ? (available - 2 * r) / (n - 1) : 0;
			const start = n > 1 ? centre - (step * (n - 1)) / 2 : centre;
			column.orbs.forEach((orb, i) => {
				nodes.set(orb.key, { x: cx, y: start + i * step, r, workspace: false });
			});
		}
		placed.push({ column, x, w, top, h });
		x += w + GAP;
	}
	return {
		width: Math.max(x - GAP + MARGIN, 320),
		height: TOP + height + LABEL_H,
		nodes,
		placed,
	};
};

/** An arrow's ends: from a workspace's rim toward its target, or an orb's right edge to the next one's left. */
const ends = (from: Point, to: Point) => {
	const angle = Math.atan2(to.y - from.y, to.x - from.x);
	const start = from.workspace
		? {
				x: from.x + Math.cos(angle) * from.r,
				y: from.y + Math.sin(angle) * from.r,
			}
		: { x: from.x + from.r, y: from.y };
	const back = Math.atan2(to.y - start.y, to.x - start.x);
	const end = to.workspace
		? {
				x: to.x - Math.cos(back) * (to.r + 3),
				y: to.y - Math.sin(back) * (to.r + 3),
			}
		: { x: to.x - to.r - 2, y: to.y };
	return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
};

const columnLabel = (column: TrafficColumn) => {
	switch (column.kind) {
		case "input":
			return "Input Ports";
		case "output":
			return "Output Ports";
		case "ports":
			return "Ports";
		default:
			return column.workspaces.length === 1
				? column.workspaces[0].label
				: "Workspaces";
	}
};

const columnStroke = (column: TrafficColumn) =>
	column.kind === "workspace"
		? WORKSPACE.border
		: column.kind === "ports"
			? "hsl(var(--content-secondary))"
			: PALETTE[column.kind].stroke;

/** ":5432", ":5432 :5433", or ":5432 :5433 +2": a side's ports, at most two written out. */
const portList = (ports: readonly number[]) => {
	const unique = [...new Set(ports)];
	const shown = unique
		.slice(0, 2)
		.map((p) => `:${p}`)
		.join(" ");
	return unique.length > 2 ? `${shown} +${unique.length - 2}` : shown;
};

/** A side's established ports on a tunnel link, near the workspace end it belongs to. */
const PortLabel: React.FC<{ x: number; y: number; text: string }> = ({
	x,
	y,
	text,
}) => {
	const width = text.length * 6.2 + 10;
	return (
		<g aria-hidden className="pointer-events-none">
			<rect
				x={x - width / 2}
				y={y - 9}
				width={width}
				height={16}
				rx={8}
				className="fill-surface-primary"
				stroke={PALETTE.output.stroke}
				strokeWidth={1}
			/>
			<text
				x={x}
				y={y + 3}
				textAnchor="middle"
				fontSize={10}
				fontWeight={700}
				className="fill-content-primary font-mono"
			>
				{text}
			</text>
		</g>
	);
};

const short = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** How often a tunnel sends a particle: busier tunnels more often; none without traffic. */
const period = (rate: number | null) =>
	rate && rate > 0
		? Math.min(1600, Math.max(260, 1600 - 260 * Math.log10(rate)))
		: null;

const LEG_MS = 420;

/** Share levels from the narrowest (only the owner) to the widest (anyone). */
const SHARE_LEVELS: readonly {
	level: WorkspaceAgentPortShareLevel;
	label: string;
}[] = [
	{ level: "owner", label: "Owner only" },
	{ level: "organization", label: "Organization" },
	{ level: "authenticated", label: "Signed-in users" },
	{ level: "public", label: "Everyone (public)" },
];

/** A shared port's change from its menu: a narrower share level, or null to stop sharing it. */
export type ShareChange = (
	orb: PortOrb,
	level: WorkspaceAgentPortShareLevel | null,
) => void;

/**
 * Particles along each tunnel's links as fast as its traffic goes: pink forward (source, port, target), blue back.
 * Drawn straight into the SVG every frame, outside React.
 */
const Pulses: React.FC<{
	topology: TrafficTopology;
	nodes: ReadonlyMap<string, Point>;
	rates: ReadonlyMap<string, TunnelRate>;
}> = ({ topology, nodes, rates }) => {
	const layer = useRef<SVGGElement>(null);
	const animations = useAnimationsEnabled();
	// The rates change with every refresh; read them live so particles in flight keep going.
	const live = useRef(rates);
	useEffect(() => {
		live.current = rates;
	}, [rates]);
	useEffect(() => {
		const g = layer.current;
		if (!g || !animations) {
			return;
		}
		const routes = topology.tunnels.map((t) => ({
			tunnel: t,
			orbs: topology.links
				.filter((l) => l.tunnelId === t.id && l.from === t.source_workspace_id)
				.map((l) => l.to),
		}));
		const next = new Map<string, number>();
		type Particle = {
			el: SVGCircleElement;
			path: Point[];
			born: number;
		};
		let particles: Particle[] = [];
		let turn = 0;
		let frame = 0;
		const tick = (now: number) => {
			for (const { tunnel, orbs } of routes) {
				const rate = live.current.get(tunnel.id);
				if (tunnel.status !== "ready" || !rate || orbs.length === 0) {
					continue;
				}
				for (const [way, value] of [
					["forward", rate.forward],
					["back", rate.back],
				] as const) {
					const every = period(value);
					const key = `${tunnel.id}:${way}`;
					if (every === null || now < (next.get(key) ?? 0)) {
						continue;
					}
					next.set(key, now + every);
					const orb = nodes.get(orbs[turn++ % orbs.length]);
					const source = nodes.get(tunnel.source_workspace_id);
					const target = nodes.get(tunnel.target_workspace_id);
					if (!orb || !source || !target) {
						continue;
					}
					const el = document.createElementNS(
						"http://www.w3.org/2000/svg",
						"circle",
					);
					el.setAttribute("r", "5");
					el.setAttribute(
						"fill",
						way === "forward" ? PALETTE.forward : PALETTE.back,
					);
					el.setAttribute("stroke", "white");
					el.setAttribute("stroke-width", "1.5");
					g.appendChild(el);
					particles.push({
						el,
						path:
							way === "forward" ? [source, orb, target] : [target, orb, source],
						born: now,
					});
				}
			}
			particles = particles.filter((p) => {
				const t = (now - p.born) / LEG_MS;
				const leg = Math.floor(t);
				if (leg >= p.path.length - 1) {
					p.el.remove();
					return false;
				}
				const a = p.path[leg];
				const b = p.path[leg + 1];
				const f = t - leg;
				const ease = f < 0.5 ? 4 * f * f * f : 1 - (-2 * f + 2) ** 3 / 2;
				p.el.setAttribute("cx", String(a.x + (b.x - a.x) * ease));
				p.el.setAttribute("cy", String(a.y + (b.y - a.y) * ease));
				return true;
			});
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			for (const p of particles) {
				p.el.remove();
			}
		};
	}, [topology, nodes, animations]);
	return <g ref={layer} aria-hidden className="pointer-events-none" />;
};

/** A workspace that died under its connections: X eyes, a frown and its tongue out, drawn on its grey orb. */
const DeadFace: React.FC<{ x: number; y: number; r: number }> = ({
	x,
	y,
	r,
}) => {
	const eye = r * 0.16;
	const eyeY = y - r * 0.2;
	const cross = (cx: number) =>
		`M${cx - eye} ${eyeY - eye}L${cx + eye} ${eyeY + eye}M${cx + eye} ${eyeY - eye}L${cx - eye} ${eyeY + eye}`;
	const mouthY = y + r * 0.38;
	const mouthW = r * 0.36;
	return (
		<g
			data-testid="dead-workspace-face"
			aria-hidden
			pointerEvents="none"
			fill="none"
			stroke="#1e293b"
			strokeWidth={Math.max(2, r * 0.08)}
			strokeLinecap="round"
		>
			<path d={`${cross(x - r * 0.32)}${cross(x + r * 0.32)}`} />
			{/* The tongue, under the frown's middle */}
			<path
				d={`M${x - r * 0.12} ${mouthY - r * 0.1}v${r * 0.16}a${r * 0.12} ${r * 0.12} 0 0 0 ${r * 0.24} 0v${-r * 0.16}z`}
				fill="#f472b6"
				stroke="#1e293b"
				strokeWidth={Math.max(1.5, r * 0.05)}
			/>
			<path
				d={`M${x - mouthW} ${mouthY}Q${x} ${mouthY - r * 0.3} ${x + mouthW} ${mouthY}`}
			/>
		</g>
	);
};

const Orb: React.FC<{
	orb: PortOrb;
	at: Point;
	hovered: boolean;
	onHover: (key: string | null) => void;
	onShareChange?: ShareChange;
}> = ({ orb, at, hovered, onHover, onShareChange }) => {
	const colors = PALETTE[orb.kind];
	const twoLines = at.r >= 24 && orb.tag.length > 0;
	const portSize = Math.max(8.5, Math.min(14.5, at.r * 0.34));
	const tagSize = Math.max(7.5, Math.min(11.5, at.r * 0.27));
	const body = (
		<g
			data-orb={orb.key}
			className={cn("cursor-default", !orb.ready && "opacity-50")}
			onMouseEnter={() => onHover(orb.key)}
			onMouseLeave={() => onHover(null)}
		>
			<title>{orb.title}</title>
			<circle
				cx={at.x}
				cy={at.y}
				r={at.r}
				fill={colors.fill}
				stroke={colors.stroke}
				strokeWidth={hovered ? 3.5 : 1.8}
				style={{ filter: "drop-shadow(0 3px 6px rgb(0 0 0 / 0.18))" }}
			/>
			<text
				x={at.x}
				y={twoLines ? at.y - tagSize * 0.32 : at.y + portSize * 0.35}
				textAnchor="middle"
				fill={colors.text}
				fontSize={portSize}
				fontWeight={800}
				className="pointer-events-none font-mono"
			>
				{orb.port}
			</text>
			{twoLines && (
				<text
					x={at.x}
					y={at.y + portSize * 0.85}
					textAnchor="middle"
					fill={colors.tag}
					fontSize={tagSize}
					fontWeight={700}
					className="pointer-events-none"
				>
					{orb.tag}
				</text>
			)}
		</g>
	);
	const share = orb.share;
	if (!share || !onShareChange) {
		return body;
	}
	// A shared port's menu: stop sharing it, or narrow who may reach it.
	const current = SHARE_LEVELS.findIndex((l) => l.level === share.share_level);
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem
					className="text-content-destructive"
					onSelect={() => onShareChange(orb, null)}
				>
					Terminate (stop sharing port {share.port})
				</ContextMenuItem>
				{current > 0 && <ContextMenuSeparator />}
				{SHARE_LEVELS.slice(0, Math.max(0, current)).map((l) => (
					<ContextMenuItem
						key={l.level}
						onSelect={() => onShareChange(orb, l.level)}
					>
						Restrict to {l.label.toLowerCase()}
					</ContextMenuItem>
				))}
			</ContextMenuContent>
		</ContextMenu>
	);
};

/**
 * One Traffic Control diagram: port and workspace columns with an arrow for every link, the links of whatever is
 * pointed at in red, and particles along the tunnels as their traffic flows. It only shows what the workspaces'
 * own configuration (their shared ports and tunnels) makes of it: there is nothing to change here.
 */
export const TrafficDiagram: React.FC<{
	topology: TrafficTopology;
	rates: ReadonlyMap<string, TunnelRate>;
	/** The workspace clicked on, whose open ports the card shows. */
	selected?: string | null;
	onSelect?: (workspaceId: string | null) => void;
	onShareChange?: ShareChange;
}> = ({ topology, rates, selected = null, onSelect, onShareChange }) => {
	const navigate = useNavigate();
	const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const [hovered, setHovered] = useState<string | null>(null);
	const { width, height, nodes, placed } = useMemo(
		() => layout(topology),
		[topology],
	);
	const orbs = useMemo(
		() =>
			new Map(
				topology.columns.flatMap((c) =>
					c.kind === "workspace" ? [] : c.orbs.map((o) => [o.key, o] as const),
				),
			),
		[topology],
	);
	const arrow = `traffic-arrow-${id}`;
	const arrowActive = `traffic-arrow-active-${id}`;
	const dot = `traffic-dot-${id}`;
	const label = topology.columns
		.map((c) =>
			c.kind === "workspace"
				? c.workspaces.map((w) => w.label).join(", ")
				: `${columnLabel(c)} ${c.orbs.map((o) => `${o.port} ${o.tag}`).join(", ")}`,
		)
		.join(" → ");
	return (
		<svg
			// a group, not an image: its workspaces and shared ports are interactive
			role="group"
			aria-label={`Traffic: ${label}`}
			viewBox={`0 0 ${width} ${height}`}
			width={width}
			className="block h-auto max-w-full select-none overflow-visible"
		>
			<defs>
				<marker
					id={arrow}
					viewBox="0 0 10 10"
					refX="8.5"
					refY="5"
					markerWidth="6"
					markerHeight="6"
					orient="auto-start-reverse"
				>
					<path
						d="M 0 1.2 L 9 5 L 0 8.8 L 2.2 5 z"
						className="fill-content-secondary"
					/>
				</marker>
				<marker
					id={arrowActive}
					viewBox="0 0 10 10"
					refX="8.5"
					refY="5"
					markerWidth="6.5"
					markerHeight="6.5"
					orient="auto-start-reverse"
				>
					<path d="M 0 1 L 9.5 5 L 0 9 L 2.2 5 z" fill={PALETTE.active} />
				</marker>
				<radialGradient id={dot} cx="35%" cy="30%" r="65%">
					<stop offset="0%" stopColor={WORKSPACE.orbLight} />
					<stop offset="55%" stopColor={WORKSPACE.orb} />
					<stop offset="100%" stopColor={WORKSPACE.orbDark} />
				</radialGradient>
			</defs>

			{placed.map(({ column, x, w, top, h }) => {
				const stroke = columnStroke(column);
				const cx = x + w / 2;
				return (
					<g key={column.key}>
						<rect
							x={x}
							y={top}
							width={w}
							height={h}
							rx={14}
							fill={
								column.kind === "workspace" ? "rgb(255 255 255 / 0.03)" : "none"
							}
							stroke={stroke}
							strokeWidth={3}
						/>
						{column.kind === "workspace" && (
							// The workspaces' badge on the box's top left corner
							<g aria-hidden data-testid="workspace-column-badge">
								<rect
									x={x - 14}
									y={top - 14}
									width={30}
									height={30}
									rx={9}
									className="fill-surface-primary"
									stroke={stroke}
									strokeWidth={2}
								/>
								<MonitorIcon
									x={x - 7}
									y={top - 7}
									width={16}
									height={16}
									color={stroke}
								/>
							</g>
						)}
						{column.kind !== "workspace" && (
							<g>
								<rect
									x={cx - 34}
									y={top - 30}
									width={68}
									height={20}
									rx={10}
									className="fill-surface-primary"
									stroke={stroke}
									strokeWidth={1.5}
								/>
								<text
									x={cx}
									y={top - 16}
									textAnchor="middle"
									fontSize={11}
									fontWeight={700}
									className="fill-content-primary tabular-nums"
								>
									{column.orbs.length}{" "}
									{column.orbs.length === 1 ? "port" : "ports"}
								</text>
							</g>
						)}
						<text
							x={cx}
							y={top + h + 34}
							textAnchor="middle"
							fill={column.kind === "workspace" ? WORKSPACE.text : stroke}
							fontSize={column.kind === "workspace" ? 18 : 16}
							fontWeight={800}
						>
							{short(
								columnLabel(column),
								column.kind === "workspace" ? 22 : 14,
							)}
						</text>
					</g>
				);
			})}

			{topology.links.map((link) => {
				const from = nodes.get(link.from);
				const to = nodes.get(link.to);
				if (!from || !to) {
					return null;
				}
				const { x1, y1, x2, y2 } = ends(from, to);
				const active = hovered === link.from || hovered === link.to;
				return (
					<line
						key={`${link.from}>${link.to}`}
						x1={x1}
						y1={y1}
						x2={x2}
						y2={y2}
						stroke={active ? PALETTE.active : "hsl(var(--content-secondary))"}
						strokeWidth={active ? 3.3 : 2.2}
						strokeDasharray={link.ready ? undefined : "6 5"}
						markerEnd={`url(#${active ? arrowActive : arrow})`}
						// a tunnel carries traffic both ways; a shared port only lets it in
						markerStart={
							link.tunnelId
								? `url(#${active ? arrowActive : arrow})`
								: undefined
						}
					/>
				);
			})}

			{/* Each tunnel's established ports on both sides: the source's beside it, the target's beside it. */}
			{topology.links.map((link) => {
				const from = nodes.get(link.from);
				const to = nodes.get(link.to);
				const orb = orbs.get(link.to) ?? orbs.get(link.from);
				if (!from || !to || !link.tunnelId || !orb?.established?.length) {
					return null;
				}
				const { x1, y1, x2, y2 } = ends(from, to);
				const sourceSide = orb.key === link.to;
				const t = sourceSide ? 0.3 : 0.7;
				return (
					<PortLabel
						key={`ports:${link.from}>${link.to}`}
						x={x1 + (x2 - x1) * t}
						y={y1 + (y2 - y1) * t - 12}
						text={portList(
							orb.established.map((e) => (sourceSide ? e.source : e.target)),
						)}
					/>
				);
			})}

			<Pulses topology={topology} nodes={nodes} rates={rates} />

			{/* A tunnel's badge on its line, halfway: the Workspace page's tunnel icon */}
			{topology.links.map((link) => {
				const from = nodes.get(link.from);
				const to = nodes.get(link.to);
				if (!from || !to || !link.tunnelId) {
					return null;
				}
				const { x1, y1, x2, y2 } = ends(from, to);
				const mx = (x1 + x2) / 2;
				const my = (y1 + y2) / 2;
				return (
					<g
						key={`tunnel:${link.from}>${link.to}`}
						aria-hidden
						data-testid="tunnel-badge"
						pointerEvents="none"
					>
						<circle
							cx={mx}
							cy={my}
							r={11}
							fill="#1e293b"
							stroke={link.ready ? "white" : "hsl(var(--content-secondary))"}
							strokeWidth={1.5}
						/>
						<image
							href="/icon/workspace-tunnel.svg"
							x={mx - 7}
							y={my - 7}
							width={14}
							height={14}
							style={{ filter: "invert(1)" }}
							opacity={link.ready ? 1 : 0.6}
						/>
					</g>
				);
			})}

			{placed.map(({ column }) =>
				column.kind === "workspace"
					? column.workspaces.map((ws) => {
							const at = nodes.get(ws.id);
							if (!at) {
								return null;
							}
							const lit = hovered === ws.id || selected === ws.id;
							// Off or offline while its tunnels still expect it: grey, with a dead face.
							const alive = ws.running && !ws.offline;
							const dead =
								!alive &&
								topology.links.some((l) => l.from === ws.id || l.to === ws.id);
							return (
								<ContextMenu key={ws.id}>
									<ContextMenuTrigger asChild>
										<g
											data-workspace={ws.id}
											role="button"
											tabIndex={0}
											aria-label={`${ws.label}: show its open ports`}
											aria-pressed={selected === ws.id}
											className="cursor-pointer outline-none"
											onMouseEnter={() => setHovered(ws.id)}
											onMouseLeave={() => setHovered(null)}
											onClick={() =>
												onSelect?.(selected === ws.id ? null : ws.id)
											}
											onKeyDown={(event) => {
												if (event.key === "Enter" || event.key === " ") {
													event.preventDefault();
													onSelect?.(selected === ws.id ? null : ws.id);
												}
											}}
										>
											<title>
												{ws.label}
												{!ws.running
													? " (not running)"
													: ws.offline
														? " (offline)"
														: ""}
												{dead ? ": its connections are down" : ""}
											</title>
											<circle
												cx={at.x}
												cy={at.y}
												r={at.r + (lit ? 15 : 10)}
												fill={
													alive ? WORKSPACE.halo : "rgb(148 163 184 / 0.18)"
												}
												className="transition-[r] duration-150"
											/>
											<circle
												cx={at.x}
												cy={at.y}
												r={at.r}
												fill={alive ? `url(#${dot})` : "#94a3b8"}
												stroke="white"
												strokeWidth={2.5}
												style={
													alive
														? {
																filter: WORKSPACE.glow,
															}
														: undefined
												}
											/>
											{dead && <DeadFace x={at.x} y={at.y} r={at.r} />}
											{column.workspaces.length > 1 && (
												<text
													x={at.x}
													y={at.y + at.r + 18}
													textAnchor="middle"
													fontSize={12}
													fontWeight={700}
													className="fill-content-primary"
												>
													{short(ws.label, 26)}
												</text>
											)}
											{selected === ws.id && (
												<circle
													cx={at.x}
													cy={at.y}
													r={at.r + 6}
													fill="none"
													stroke="white"
													strokeWidth={2}
													strokeDasharray="4 3"
												/>
											)}
										</g>
									</ContextMenuTrigger>
									<ContextMenuContent>
										<ContextMenuItem onSelect={() => navigate(ws.href)}>
											Open workspace
										</ContextMenuItem>
										<ContextMenuItem
											onSelect={() =>
												onSelect?.(selected === ws.id ? null : ws.id)
											}
										>
											{selected === ws.id
												? "Hide open ports"
												: "Show open ports"}
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
							);
						})
					: column.orbs.map((orb) => {
							const at = nodes.get(orb.key);
							return at ? (
								<Orb
									key={orb.key}
									orb={orb}
									at={at}
									hovered={hovered === orb.key}
									onHover={setHovered}
									onShareChange={onShareChange}
								/>
							) : null;
						}),
			)}
		</svg>
	);
};
