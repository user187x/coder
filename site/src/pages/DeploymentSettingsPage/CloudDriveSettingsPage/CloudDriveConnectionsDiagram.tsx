import { CloudIcon, LockIcon, MonitorIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useQuery } from "react-query";
import { useNavigate } from "react-router";
import type {
	CloudDriveConnectionsOverview,
	CloudDriveWorkspaceState,
} from "#/api/platform";
import { cloudDriveConnectionsOverview } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";

type Drive = CloudDriveConnectionsOverview["drives"][number];

const MARGIN = 40;
const TOP = 40;
const DRIVE_R = 30;
const WS_R = 22;
const WS_STEP = 108;
const PER_ROW = 6;
const ROW_H = 2 * WS_R + 50;
const DRIVE_TO_BOX = 70;
const GROUP_GAP = 56;
const MIN_GROUP_W = 200;

/** Traffic Control's colours: the drive as its blue input orb, the workspaces in the theme's accent. */
const DRIVE = {
	fill: "#75bdca",
	stroke: "#4f9aa6",
	icon: "#0f2e33",
} as const;
const WORKSPACE = {
	border: "hsl(var(--content-link))",
	text: "color-mix(in srgb, hsl(var(--content-link)) 70%, white)",
	orbLight: "color-mix(in srgb, hsl(var(--content-link)) 50%, white)",
	orb: "hsl(var(--content-link))",
	orbDark: "color-mix(in srgb, hsl(var(--content-link)) 70%, black)",
	halo: "hsl(var(--content-link) / 0.22)",
	glow: "drop-shadow(0 0 12px hsl(var(--content-link) / 0.7))",
} as const;
const ACTIVE = "#dc352e";
const OFF = "#94a3b8";

const STATE_LABEL: Record<CloudDriveWorkspaceState, string> = {
	connected: "connected",
	disconnected: "disconnected by its owner",
	shared: "shared with others, so never connected",
};

type Point = { x: number; y: number };

type PlacedDrive = {
	drive: Drive;
	at: Point;
	box: { x: number; y: number; w: number; h: number };
	workspaces: Map<string, Point>;
};

const short = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Each drive in the top row, its workspaces in rows of PER_ROW in a box below it; the diagram's size. */
const layout = (drives: readonly Drive[]) => {
	const placed: PlacedDrive[] = [];
	let x = MARGIN;
	let bottom = 0;
	for (const drive of drives) {
		const n = drive.workspaces.length;
		const rows = Math.max(1, Math.ceil(n / PER_ROW));
		const w = Math.max(MIN_GROUP_W, Math.min(n, PER_ROW) * WS_STEP);
		const cx = x + w / 2;
		const at = { x: cx, y: TOP + DRIVE_R };
		const boxTop = at.y + DRIVE_R + DRIVE_TO_BOX;
		const workspaces = new Map<string, Point>();
		drive.workspaces.forEach((ws, i) => {
			const row = Math.floor(i / PER_ROW);
			const inRow = Math.min(PER_ROW, n - row * PER_ROW);
			const col = i % PER_ROW;
			workspaces.set(ws.id, {
				x: cx + (col - (inRow - 1) / 2) * WS_STEP,
				y: boxTop + 24 + WS_R + row * ROW_H,
			});
		});
		const box = { x, y: boxTop, w, h: rows * ROW_H + 12 };
		placed.push({ drive, at, box, workspaces });
		bottom = Math.max(bottom, box.y + box.h);
		x += w + GROUP_GAP;
	}
	return {
		width: Math.max(x - GROUP_GAP + MARGIN, 320),
		height: bottom + MARGIN,
		placed,
	};
};

/** A connector running down from the drive's bottom to the top of a workspace's orb. */
const connector = (from: Point, to: Point) => {
	const y1 = from.y + DRIVE_R;
	const y2 = to.y - WS_R - 3;
	const bend = (y2 - y1) * 0.55;
	return `M${from.x} ${y1}C${from.x} ${y1 + bend} ${to.x} ${y2 - bend} ${to.x} ${y2}`;
};

/**
 * Every account's Cloud Drive across the top, the workspaces it is linked into below it: a solid connector to each
 * connected one, a dashed one to a workspace its owner disconnected or one shared with others (grey). Pointing at a
 * drive or a workspace lights its connectors; a workspace opens its page.
 */
const CloudDriveConnectionsDiagram: React.FC<{
	drives: readonly Drive[];
}> = ({ drives }) => {
	const navigate = useNavigate();
	const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const [hovered, setHovered] = useState<string | null>(null);
	const { width, height, placed } = useMemo(() => layout(drives), [drives]);
	const arrow = `drive-arrow-${id}`;
	const arrowActive = `drive-arrow-active-${id}`;
	const dot = `drive-dot-${id}`;

	return (
		<div className="overflow-x-auto">
			<svg
				role="group"
				aria-label="Cloud Drive connections"
				viewBox={`0 0 ${width} ${height}`}
				width={width}
				height={height}
				className="block select-none overflow-visible"
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
						<path d="M 0 1 L 9.5 5 L 0 9 L 2.2 5 z" fill={ACTIVE} />
					</marker>
					<radialGradient id={dot} cx="35%" cy="30%" r="65%">
						<stop offset="0%" stopColor={WORKSPACE.orbLight} />
						<stop offset="55%" stopColor={WORKSPACE.orb} />
						<stop offset="100%" stopColor={WORKSPACE.orbDark} />
					</radialGradient>
				</defs>

				{placed.map(({ drive, at, box, workspaces }) => {
					const owner = drive.owner.username || "Unknown";
					const connected = drive.workspaces.filter(
						(w) => w.state === "connected",
					).length;
					return (
						<svg
							key={drive.owner.id}
							role="group"
							overflow="visible"
							aria-label={`${owner}'s Cloud Drive: ${connected} of ${drive.workspaces.length} workspaces connected`}
						>
							<rect
								x={box.x}
								y={box.y}
								width={box.w}
								height={box.h}
								rx={14}
								fill="rgb(255 255 255 / 0.03)"
								stroke={WORKSPACE.border}
								strokeWidth={3}
							/>
							<g aria-hidden>
								<rect
									x={box.x - 14}
									y={box.y - 14}
									width={30}
									height={30}
									rx={9}
									className="fill-surface-primary"
									stroke={WORKSPACE.border}
									strokeWidth={2}
								/>
								<MonitorIcon
									x={box.x - 7}
									y={box.y - 7}
									width={16}
									height={16}
									color={WORKSPACE.border}
								/>
								<rect
									x={box.x + box.w / 2 - 44}
									y={box.y + box.h - 10}
									width={88}
									height={20}
									rx={10}
									className="fill-surface-primary"
									stroke={WORKSPACE.border}
									strokeWidth={1.5}
								/>
								<text
									x={box.x + box.w / 2}
									y={box.y + box.h + 4}
									textAnchor="middle"
									fontSize={11}
									fontWeight={700}
									className="fill-content-primary tabular-nums"
								>
									{connected} of {drive.workspaces.length} linked
								</text>
							</g>

							{drive.workspaces.map((ws) => {
								const to = workspaces.get(ws.id);
								if (!to) {
									return null;
								}
								const active = hovered === drive.owner.id || hovered === ws.id;
								return (
									<svg
										key={ws.id}
										role="img"
										overflow="visible"
										aria-label={`${owner}'s Cloud Drive to ${ws.name}: ${STATE_LABEL[ws.state]}`}
									>
										<path
											d={connector(at, to)}
											fill="none"
											stroke={active ? ACTIVE : "hsl(var(--content-secondary))"}
											strokeWidth={active ? 3.3 : 2.2}
											strokeDasharray={
												ws.state === "connected" ? undefined : "6 5"
											}
											markerEnd={`url(#${active ? arrowActive : arrow})`}
										/>
									</svg>
								);
							})}

							<g
								aria-hidden
								onMouseEnter={() => setHovered(drive.owner.id)}
								onMouseLeave={() => setHovered(null)}
							>
								<title>
									{owner}'s Cloud Drive
									{drive.encrypted ? " (encrypted)" : ""}
								</title>
								<text
									x={at.x}
									y={at.y - DRIVE_R - 12}
									textAnchor="middle"
									fontSize={16}
									fontWeight={800}
									fill={WORKSPACE.text}
								>
									{short(owner, 22)}
								</text>
								<circle
									cx={at.x}
									cy={at.y}
									r={DRIVE_R}
									fill={DRIVE.fill}
									stroke={DRIVE.stroke}
									strokeWidth={hovered === drive.owner.id ? 3.5 : 1.8}
									style={{ filter: "drop-shadow(0 3px 6px rgb(0 0 0 / 0.18))" }}
								/>
								<CloudIcon
									x={at.x - 14}
									y={at.y - 14}
									width={28}
									height={28}
									color={DRIVE.icon}
								/>
								{drive.encrypted && (
									<g>
										<circle
											cx={at.x + DRIVE_R * 0.75}
											cy={at.y + DRIVE_R * 0.75}
											r={10}
											className="fill-surface-primary"
											stroke={DRIVE.stroke}
											strokeWidth={1.5}
										/>
										<LockIcon
											x={at.x + DRIVE_R * 0.75 - 6}
											y={at.y + DRIVE_R * 0.75 - 6}
											width={12}
											height={12}
											color={DRIVE.icon}
										/>
									</g>
								)}
							</g>

							{drive.workspaces.map((ws) => {
								const to = workspaces.get(ws.id);
								if (!to) {
									return null;
								}
								const on = ws.state === "connected";
								const lit = hovered === ws.id;
								const href = `/@${drive.owner.username}/${ws.name}`;
								const source =
									drive.source === ws.id
										? ", its folder is the Cloud Drive"
										: "";
								return (
									<g
										key={ws.id}
										role="link"
										tabIndex={0}
										aria-label={`${ws.name} (${owner}): ${STATE_LABEL[ws.state]}${source}`}
										className="cursor-pointer outline-none"
										onMouseEnter={() => setHovered(ws.id)}
										onMouseLeave={() => setHovered(null)}
										onFocus={() => setHovered(ws.id)}
										onBlur={() => setHovered(null)}
										onClick={() => navigate(href)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												navigate(href);
											}
										}}
									>
										<title>
											{ws.name}: {STATE_LABEL[ws.state]}
											{source}
										</title>
										<circle
											cx={to.x}
											cy={to.y}
											r={WS_R + (lit ? 15 : 10)}
											fill={on ? WORKSPACE.halo : "rgb(148 163 184 / 0.18)"}
											className="transition-[r] duration-150"
										/>
										<circle
											cx={to.x}
											cy={to.y}
											r={WS_R}
											fill={on ? `url(#${dot})` : OFF}
											stroke="white"
											strokeWidth={2.5}
											style={on ? { filter: WORKSPACE.glow } : undefined}
										/>
										{drive.source === ws.id && (
											<CloudIcon
												aria-hidden
												x={to.x - 9}
												y={to.y - 9}
												width={18}
												height={18}
												color="white"
											/>
										)}
										<text
											x={to.x}
											y={to.y + WS_R + 18}
											textAnchor="middle"
											fontSize={12}
											fontWeight={700}
											className="fill-content-primary"
										>
											{short(ws.name, 14)}
										</text>
									</g>
								);
							})}
						</svg>
					);
				})}
			</svg>
		</div>
	);
};

/** The card's states: reading, an error, no workspace connected anywhere, or the diagram. */
export const CloudDriveConnectionsView: React.FC<{
	overview?: CloudDriveConnectionsOverview;
	error?: unknown;
	isLoading: boolean;
}> = ({ overview, error, isLoading }) => {
	const drives = overview?.drives ?? [];
	const anyConnected = drives.some((d) =>
		d.workspaces.some((w) => w.state === "connected"),
	);
	return (
		<section
			aria-labelledby="cloud-drive-connections-title"
			className="flex flex-col gap-4 rounded-lg border border-solid border-border bg-surface-primary px-6 py-5"
		>
			<div className="flex flex-col gap-1">
				<h2
					id="cloud-drive-connections-title"
					className="m-0 text-base font-semibold text-content-primary"
				>
					Connected workspaces
				</h2>
				<p className="m-0 text-sm text-content-secondary">
					Each user's Cloud Drive and the workspaces it is linked into. A dashed
					connector leads to a workspace its owner disconnected, or one shared
					with others.
				</p>
			</div>
			{error ? (
				<ErrorAlert error={error} />
			) : isLoading ? (
				<Loader />
			) : !anyConnected ? (
				<p className="m-0 text-sm text-content-secondary">
					No workspaces are connected to a Cloud Drive.
				</p>
			) : (
				<CloudDriveConnectionsDiagram drives={drives} />
			)}
		</section>
	);
};

/** Admin Settings > Cloud Drive: which workspaces are connected to each user's Cloud Drive. */
export const CloudDriveConnectionsCard: React.FC = () => {
	const overview = useQuery(cloudDriveConnectionsOverview());
	return (
		<CloudDriveConnectionsView
			overview={overview.data}
			error={overview.error}
			isLoading={overview.isLoading}
		/>
	);
};
