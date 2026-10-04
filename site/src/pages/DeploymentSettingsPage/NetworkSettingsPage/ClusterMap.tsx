import { cn } from "cn";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "react-query";
import type {
	ClusterNode,
	CoderPod,
	NetworkReport,
	NetworkWorkspace,
} from "#/api/platform";
import { networkReport } from "#/api/queries/platform";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableEmpty } from "#/components/TableEmpty/TableEmpty";

const ago = (iso: string | null, now: number): string => {
	if (!iso) {
		return "N/A";
	}
	const s = Math.max(0, (now - Date.parse(iso)) / 1000);
	if (!Number.isFinite(s)) {
		return "N/A";
	}
	return s < 90
		? `${Math.round(s)} s`
		: s < 5400
			? `${Math.round(s / 60)} min`
			: s < 129_600
				? `${Math.round(s / 3600)} h`
				: `${Math.round(s / 86_400)} d`;
};

const cores = (c: number | null | undefined) =>
	c == null || !Number.isFinite(c)
		? "N/A"
		: c < 1
			? `${Math.round(c * 1000)}m`
			: `${+c.toFixed(c < 10 ? 2 : 1)}`;

const bytes = (b: number | null | undefined) => {
	if (b == null || !Number.isFinite(b)) {
		return "N/A";
	}
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	let value = b;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i += 1;
	}
	return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

const percent = (
	value: number | null | undefined,
	total: number | null | undefined,
) => (value != null && total ? Math.min(100, (value / total) * 100) : null);

const agentOk = (w: NetworkWorkspace) =>
	w.agents.length > 0 && w.agents.every((a) => a.status === "connected");

const agentLabel = (w: NetworkWorkspace) => {
	if (w.orphan) {
		return "pod only: not running in Coder";
	}
	if (!w.agents.length) {
		return "no agent";
	}
	const bad = w.agents.filter((a) => a.status !== "connected");
	return bad.length
		? bad.map((a) => `${a.name}: ${a.status}`).join(", ")
		: w.agents.length === 1
			? "connected"
			: `${w.agents.length} connected`;
};

const nodeStatus = (n: ClusterNode): ["error" | "warn" | "ok", string] =>
	!n.ready
		? ["error", "Not ready"]
		: n.unschedulable
			? ["warn", "Cordoned"]
			: n.pressure.length
				? ["warn", n.pressure.join(", ")]
				: ["ok", "Ready"];

// One clock for the "updated N s ago" and ages, ticking every second.
let clock = Date.now();
const subscribeToClock = (listener: () => void) => {
	const timer = window.setInterval(() => {
		clock = Date.now();
		listener();
	}, 1000);
	return () => window.clearInterval(timer);
};
const useNow = () => useSyncExternalStore(subscribeToClock, () => clock);

/**
 * General > Network (top of the page): a live map of the Kubernetes cluster
 * Coder runs on. Every node with its addresses, pod CIDR, CPU and memory
 * (live usage when metrics-server runs, else the pods' requests) and the
 * Coder pods and workspaces placed on it; lines show the way in (access URL
 * to Coder) and each workspace agent's connection. Re-read every 5 seconds.
 */
export const ClusterMap: React.FC = () => {
	const [paused, setPaused] = useState(false);
	const query = useQuery(networkReport(paused));

	return (
		<section>
			<SettingsHeader>
				<SettingsHeaderTitle>Cluster Network</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					A live map of the Kubernetes cluster Coder runs on: nodes, their
					addresses and load, and the workspaces on each. Refreshes every 5
					seconds.
				</SettingsHeaderDescription>
			</SettingsHeader>
			{query.isLoading ? (
				<Loader />
			) : (
				<div className="flex flex-col gap-6">
					<section
						aria-labelledby="cluster-map"
						className="flex flex-col gap-5 rounded-lg border border-solid border-border p-6"
					>
						<div className="flex flex-wrap items-center justify-between gap-3">
							<h2 id="cluster-map" className="m-0 text-base font-semibold">
								Cluster map
							</h2>
							<div className="flex items-center gap-3">
								<LiveStatus paused={paused} updatedAt={query.dataUpdatedAt} />
								<Button
									size="sm"
									variant="outline"
									aria-pressed={paused}
									onClick={() => setPaused(!paused)}
								>
									{paused ? "Resume" : "Pause"}
								</Button>
							</div>
						</div>
						{query.error ? (
							<p role="alert" className="m-0 text-sm text-content-destructive">
								The cluster could not be read:{" "}
								{query.error instanceof Error
									? query.error.message
									: "unknown error"}
							</p>
						) : null}
						{query.data && <Topology report={query.data} />}
					</section>
					{query.data && <WorkspacesTable report={query.data} />}
					{query.data && <NodesTable report={query.data} />}
				</div>
			)}
		</section>
	);
};

const LiveStatus: React.FC<{ paused: boolean; updatedAt: number }> = ({
	paused,
	updatedAt,
}) => {
	const now = useNow();
	const age = updatedAt ? Math.round((now - updatedAt) / 1000) : null;
	const stale = !paused && age !== null && age > 15;
	return (
		<span
			className="inline-flex items-center gap-2 text-sm tabular-nums text-content-secondary"
			data-pixel="ignore"
		>
			<span
				aria-hidden
				className={cn(
					"size-2 rounded-full",
					paused
						? "bg-content-secondary"
						: stale
							? "bg-content-warning"
							: "bg-content-success animate-pulse motion-reduce:animate-none",
				)}
			/>
			{paused
				? "Paused"
				: age === null
					? "Loading…"
					: `Live · updated ${age} s ago`}
		</span>
	);
};

const Tile: React.FC<{ label: string; value: string; sub?: string }> = ({
	label,
	value,
	sub,
}) => (
	<div className="min-w-0 rounded-lg border border-solid border-border px-3.5 py-3">
		<div className="text-xs font-medium text-content-secondary">{label}</div>
		<div
			className="truncate text-[22px] font-semibold leading-snug tabular-nums"
			title={value}
		>
			{value}
		</div>
		<div className="truncate text-xs text-content-secondary" title={sub}>
			{sub || " "}
		</div>
	</div>
);

const Tiles: React.FC<{ report: NetworkReport }> = ({ report: d }) => {
	const sum = (pick: (n: ClusterNode) => number | null | undefined) =>
		d.nodes.reduce((total, n) => total + (pick(n) ?? 0), 0);
	const ready = d.nodes.filter((n) => n.ready).length;
	const cordoned = d.nodes.filter((n) => n.unschedulable).length;
	const podCapacity = sum((n) => n.allocatable.pods);
	const onNodes = new Set(d.workspaces.map((w) => w.pod.node)).size;
	const coder = d.coder.filter((p) => p.role === "coder");
	const running =
		d.workspaces.filter((w) => !w.orphan).length + d.unplaced.length;

	return (
		<div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
			<Tile
				label="Nodes"
				value={`${ready} / ${d.nodes.length} ready`}
				sub={
					cordoned
						? `${cordoned} cordoned`
						: d.kubernetesVersion
							? `Kubernetes ${d.kubernetesVersion}`
							: undefined
				}
			/>
			<Tile
				label="Running workspaces"
				value={String(running)}
				sub={
					d.workspaces.length
						? `on ${onNodes} ${onNodes === 1 ? "node" : "nodes"}`
						: "none on this cluster"
				}
			/>
			<Tile
				label="Coder servers"
				value={`${coder.filter((p) => p.ready).length} / ${coder.length} ready`}
				sub={coder
					.map((p) => p.podIP)
					.filter(Boolean)
					.join(", ")}
			/>
			<Tile
				label="Pods"
				value={`${sum((n) => n.podCount)}${podCapacity ? ` / ${podCapacity}` : ""}`}
				sub="all namespaces"
			/>
			{d.metrics ? (
				<Tile
					label="CPU in use (cores)"
					value={`${cores(sum((n) => n.usage?.cpu))} / ${cores(sum((n) => n.allocatable.cpu))}`}
					sub={`memory ${bytes(sum((n) => n.usage?.memory))} / ${bytes(sum((n) => n.allocatable.memory))}`}
				/>
			) : (
				<Tile
					label="CPU allocatable (cores)"
					value={cores(sum((n) => n.allocatable.cpu))}
					sub={`memory ${bytes(sum((n) => n.allocatable.memory))} · no metrics-server`}
				/>
			)}
		</div>
	);
};

type LinkPath = { kind: "entry" | "ok" | "bad"; d: string };

/**
 * Curves from the way in to each Coder server, and from a Coder server to
 * every workspace (its agent's connection), measured from the drawn cards.
 */
const useLinks = (
	container: React.RefObject<HTMLDivElement | null>,
	report: NetworkReport,
) => {
	const [paths, setPaths] = useState<LinkPath[]>([]);
	const [box, setBox] = useState({ width: 0, height: 0 });

	useLayoutEffect(() => {
		const root = container.current;
		if (!root) {
			return;
		}
		const draw = () => {
			const outer = root.getBoundingClientRect();
			const at = (el: Element, side: "left" | "right" | "top") => {
				const r = el.getBoundingClientRect();
				return side === "right"
					? [r.right - outer.left, r.top - outer.top + r.height / 2]
					: side === "left"
						? [r.left - outer.left, r.top - outer.top + r.height / 2]
						: [r.left - outer.left + r.width / 2, r.top - outer.top];
			};
			const next: LinkPath[] = [];
			const entry = root.querySelector("[data-entry]");
			const servers = [...root.querySelectorAll("[data-coder-server]")];
			if (entry) {
				for (const server of servers) {
					const [x1, y1] = at(entry, "right");
					const [x2, y2] = at(server, "left");
					const dx = Math.max(30, Math.abs(x2 - x1) / 2);
					next.push({
						kind: "entry",
						d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
					});
				}
			}
			const hub = servers[0];
			if (hub) {
				for (const ws of root.querySelectorAll<HTMLElement>(
					"[data-workspace]",
				)) {
					const [hx, hy] = at(hub, "top");
					const [wx, wy] = at(ws, "top");
					const lift = Math.min(hy, wy) - 18;
					next.push({
						kind: ws.dataset.workspace === "ok" ? "ok" : "bad",
						d: `M${hx},${hy} C${hx},${lift} ${wx},${lift} ${wx},${wy}`,
					});
				}
			}
			setBox({ width: outer.width, height: outer.height });
			setPaths(next);
		};
		draw();
		const observer = new ResizeObserver(() => requestAnimationFrame(draw));
		observer.observe(root);
		return () => observer.disconnect();
	}, [container, report]);

	return { paths, box };
};

const Topology: React.FC<{ report: NetworkReport }> = ({ report }) => {
	const container = useRef<HTMLDivElement>(null);
	const { paths, box } = useLinks(container, report);
	const now = useNow();
	let host = report.accessUrl;
	try {
		host = new URL(report.accessUrl).host;
	} catch {
		// Keep it as it is.
	}

	return (
		<>
			<Tiles report={report} />
			<div
				ref={container}
				className="relative grid items-start gap-14 md:grid-cols-[minmax(180px,220px)_minmax(0,1fr)]"
			>
				<svg
					aria-hidden
					className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible"
					viewBox={`0 0 ${box.width} ${box.height}`}
				>
					{paths.map((path, i) => (
						<path
							key={i}
							d={path.d}
							fill="none"
							strokeWidth={2}
							strokeDasharray={path.kind === "bad" ? "5 5" : undefined}
							className={cn(
								path.kind === "entry"
									? "stroke-content-link/60"
									: path.kind === "ok"
										? "stroke-content-success/70"
										: "stroke-content-warning/80",
							)}
						/>
					))}
				</svg>
				<div
					data-entry=""
					className="relative z-[1] grid gap-2.5 rounded-lg border border-dashed border-border p-3.5"
				>
					<div className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
						Way in
					</div>
					<div className="font-semibold break-all">{host || "Access URL"}</div>
					<div className="text-xs text-content-secondary">
						Browsers and CLIs reach Coder here (Gateway → Service). Workspace
						agents dial back to Coder the same way.
					</div>
				</div>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
					{report.nodes.map((node) => (
						<NodeCard key={node.name} node={node} report={report} now={now} />
					))}
				</div>
			</div>
			<div className="flex flex-wrap gap-x-4.5 gap-y-1.5 text-xs text-content-secondary">
				<LegendChip className="bg-content-link" label="Coder server" />
				<LegendChip className="bg-content-warning" label="Database" />
				<LegendChip className="bg-content-secondary" label="Add-on" />
				<LegendChip className="bg-content-success" label="Workspace" />
				<span className="inline-flex items-center gap-1.5">
					<i className="w-5.5 border-0 border-t-2 border-solid border-content-success/70" />
					Agent connected
				</span>
				<span className="inline-flex items-center gap-1.5">
					<i className="w-5.5 border-0 border-t-2 border-dashed border-content-warning/80" />
					Agent not connected
				</span>
			</div>
		</>
	);
};

const LegendChip: React.FC<{ className: string; label: string }> = ({
	className,
	label,
}) => (
	<span className="inline-flex items-center gap-1.5">
		<i className={cn("h-3 w-[3px] rounded-sm", className)} />
		{label}
	</span>
);

type ChipProps = {
	kind: CoderPod["role"] | "workspace-bad";
	name: string;
	sub?: string | null;
	title: string;
	dimmed?: boolean;
} & React.ComponentProps<"div">;

const CHIP_COLORS: Record<ChipProps["kind"], string> = {
	coder: "before:bg-content-link",
	database: "before:bg-content-warning",
	"add-on": "before:bg-content-secondary",
	workspace: "before:bg-content-success",
	"workspace-bad": "before:bg-content-destructive",
};

const Chip: React.FC<ChipProps> = ({
	kind,
	name,
	sub,
	title,
	dimmed,
	...attrs
}) => (
	<div
		title={title}
		className={cn(
			"relative inline-flex min-w-0 max-w-full flex-col gap-px rounded-md border border-solid border-border bg-surface-secondary py-1.5 pr-2.5 pl-3 text-xs leading-tight",
			"before:absolute before:top-1 before:bottom-1 before:left-0 before:w-[3px] before:rounded-sm before:content-['']",
			CHIP_COLORS[kind],
			dimmed && "opacity-60",
		)}
		{...attrs}
	>
		<b className="truncate font-semibold">{name}</b>
		{sub && (
			<small className="whitespace-nowrap font-mono text-[11px] text-content-secondary">
				{sub}
			</small>
		)}
	</div>
);

type MeterProps = {
	label: string;
	value: number | null | undefined;
	requested: number;
	total: number | null;
	format: (value: number | null | undefined) => string;
};

const Meter: React.FC<MeterProps> = ({
	label,
	value,
	requested,
	total,
	format,
}) => {
	const used = percent(value, total);
	const reserved = percent(requested, total);
	const hot = used !== null && used >= 90;
	const text =
		used === null
			? `${format(requested)} requested`
			: `${format(value)} / ${format(total)}${hot ? " · high" : ""}`;
	return (
		<div
			role="meter"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={used === null ? undefined : Math.round(used)}
			aria-valuetext={text}
			title={`${label}: ${format(value)} in use, ${format(requested)} requested by pods, ${format(total)} allocatable`}
			className="grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-2 text-xs"
		>
			<span>{label}</span>
			<span className="relative h-2 overflow-hidden rounded bg-surface-tertiary">
				{used !== null && (
					<span
						className={cn(
							"absolute inset-y-0 left-0 rounded",
							hot ? "bg-content-destructive" : "bg-content-link",
						)}
						style={{ width: `${used.toFixed(1)}%` }}
					/>
				)}
				{reserved !== null && value !== requested && (
					<span
						className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-content-primary opacity-55"
						style={{ left: `calc(${reserved.toFixed(1)}% - 1px)` }}
					/>
				)}
			</span>
			<span className="whitespace-nowrap text-content-secondary tabular-nums">
				{text}
			</span>
		</div>
	);
};

type NodeCardProps = { node: ClusterNode; report: NetworkReport; now: number };

const NodeCard: React.FC<NodeCardProps> = ({ node: n, report, now }) => {
	const coder = report.coder.filter((p) => p.node === n.name);
	const workspaces = report.workspaces.filter((w) => w.pod.node === n.name);
	const [status, statusLabel] = nodeStatus(n);
	const meta: [string, string][] = [
		["Internal IP", (n.addresses.InternalIP ?? []).join(", ")],
		["External IP", (n.addresses.ExternalIP ?? []).join(", ")],
		["Pod CIDR", n.podCIDRs.join(", ")],
		["Zone", [n.region, n.zone].filter(Boolean).join(" / ")],
		["Kubelet", [n.kubelet, n.arch].filter(Boolean).join(" · ")],
	];

	return (
		<article
			aria-label={`Node ${n.name}`}
			className={cn(
				"relative z-[1] grid min-w-0 gap-3 rounded-[10px] border border-solid px-4 py-3.5",
				n.ready ? "border-border" : "border-content-destructive",
			)}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-[15px] font-semibold">{n.name}</span>
				<Badge
					size="xs"
					variant={
						status === "error"
							? "destructive"
							: status === "warn"
								? "warning"
								: "green"
					}
				>
					{statusLabel}
				</Badge>
			</div>
			<div className="text-xs text-content-secondary">
				{n.roles.join(", ")} · {n.podCount} pods
				{n.allocatable.pods ? ` of ${n.allocatable.pods}` : ""} · up{" "}
				{ago(n.created, now)}
			</div>
			<dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
				{meta
					.filter(([, value]) => value)
					.map(([key, value]) => (
						<div key={key} className="contents">
							<dt className="text-content-secondary">{key}</dt>
							<dd className="m-0 font-mono [overflow-wrap:anywhere]">
								{value}
							</dd>
						</div>
					))}
			</dl>
			<Meter
				label="CPU"
				value={n.usage?.cpu}
				requested={n.requests.cpu}
				total={n.allocatable.cpu}
				format={cores}
			/>
			<Meter
				label="Memory"
				value={n.usage?.memory}
				requested={n.requests.memory}
				total={n.allocatable.memory}
				format={bytes}
			/>
			{coder.length > 0 && (
				<div>
					<p className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
						Coder ({report.coderNamespace})
					</p>
					<div className="flex flex-wrap gap-1.5">
						{coder.map((pod) => (
							<Chip
								key={pod.name}
								kind={pod.role}
								name={pod.name}
								sub={pod.podIP}
								dimmed={!pod.ready}
								data-coder-server={pod.role === "coder" ? "" : undefined}
								title={`${pod.role} · ${pod.name}\nIP ${pod.podIP ?? "N/A"} · ${pod.ready ? "ready" : "not ready"} · ${pod.restarts} restarts · up ${ago(pod.started, now)}`}
							/>
						))}
					</div>
				</div>
			)}
			<div>
				<p className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
					Workspaces ({workspaces.length})
				</p>
				{workspaces.length ? (
					<div className="flex flex-wrap gap-1.5">
						{workspaces.map((w) => {
							const ok = agentOk(w);
							const agent = w.agents[0];
							return (
								<Chip
									key={w.id}
									kind={ok ? "workspace" : "workspace-bad"}
									name={`${w.owner}/${w.name}`}
									sub={w.pod.podIP}
									data-workspace={ok ? "ok" : "bad"}
									title={`${w.owner}/${w.name} (${w.template ?? "N/A"})\npod ${w.pod.name} · IP ${w.pod.podIP ?? "N/A"}\nagent: ${agentLabel(w)}${agent?.latencyMs != null ? ` · ${agent.latencyMs.toFixed(0)} ms` : ""}`}
								/>
							);
						})}
					</div>
				) : (
					<p className="m-0 text-xs text-content-secondary">
						No workspaces on this node.
					</p>
				)}
			</div>
		</article>
	);
};

const StatusDot: React.FC<{
	status: "ok" | "warn" | "error";
	children: React.ReactNode;
}> = ({ status, children }) => (
	<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
		<span
			aria-hidden
			className={cn(
				"size-2 rounded-full",
				status === "ok"
					? "bg-content-success"
					: status === "warn"
						? "bg-content-warning"
						: "bg-content-destructive",
			)}
		/>
		{children}
	</span>
);

const WorkspacesTable: React.FC<{ report: NetworkReport }> = ({ report }) => {
	const now = useNow();
	return (
		<section
			aria-labelledby="cluster-workspaces"
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="cluster-workspaces" className="m-0 text-base font-semibold">
					Workspaces by node
				</h2>
				<span className="text-xs text-content-secondary">
					{report.workspaces.length} running
				</span>
			</div>
			<div className="overflow-x-auto">
				<Table aria-label="Workspaces by node">
					<TableHeader>
						<TableRow>
							{[
								"Workspace",
								"Owner",
								"Template",
								"Node",
								"Pod IP",
								"Agent",
								"Latency",
								"Restarts",
								"Running since",
							].map((h) => (
								<TableHead key={h}>{h}</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{report.workspaces.length ? (
							report.workspaces.map((w) => {
								const agent = w.agents[0];
								return (
									<TableRow key={w.id}>
										<TableCell>{w.name}</TableCell>
										<TableCell>{w.owner}</TableCell>
										<TableCell>{w.template ?? "N/A"}</TableCell>
										<TableCell className="font-mono text-xs">
											{w.pod.node ?? "N/A"}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{w.pod.podIP ?? "N/A"}
										</TableCell>
										<TableCell>
											<StatusDot status={agentOk(w) ? "ok" : "warn"}>
												{agentLabel(w)}
											</StatusDot>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{agent?.latencyMs != null
												? `${agent.latencyMs.toFixed(0)} ms`
												: "N/A"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{w.pod.restarts}
										</TableCell>
										<TableCell
											className="text-right tabular-nums"
											data-pixel="ignore"
										>
											{ago(w.pod.started, now)}
										</TableCell>
									</TableRow>
								);
							})
						) : (
							<TableEmpty message="No running workspaces have a pod in this cluster." />
						)}
					</TableBody>
				</Table>
			</div>
			{report.unplaced.length > 0 && (
				<p className="m-0 text-sm text-content-secondary">
					Running outside this cluster (no pod found):{" "}
					{report.unplaced.map((w) => `${w.owner}/${w.name}`).join(", ")}
				</p>
			)}
		</section>
	);
};

const NodesTable: React.FC<{ report: NetworkReport }> = ({ report }) => {
	const now = useNow();
	return (
		<section
			aria-labelledby="cluster-nodes"
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="cluster-nodes" className="m-0 text-base font-semibold">
					Nodes
				</h2>
				<span className="text-xs text-content-secondary">
					{report.nodes.length} {report.nodes.length === 1 ? "node" : "nodes"}
					{report.metrics
						? ""
						: " · usage needs metrics-server (showing requests)"}
				</span>
			</div>
			<div className="overflow-x-auto">
				<Table aria-label="Nodes">
					<TableHeader>
						<TableRow>
							{[
								"Node",
								"Status",
								"Roles",
								"Internal IP",
								"External IP",
								"Pod CIDR",
								"CPU",
								"Memory",
								"Pods",
								"Kubelet",
								"OS / kernel",
								"Runtime",
								"Taints",
								"Age",
							].map((h) => (
								<TableHead key={h}>{h}</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{report.nodes.map((n) => {
							const [status, label] = nodeStatus(n);
							return (
								<TableRow key={n.name} className="whitespace-nowrap">
									<TableCell>{n.name}</TableCell>
									<TableCell>
										<StatusDot status={status}>{label}</StatusDot>
									</TableCell>
									<TableCell>{n.roles.join(", ")}</TableCell>
									<TableCell className="font-mono text-xs">
										{(n.addresses.InternalIP ?? []).join(", ") || "N/A"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{(n.addresses.ExternalIP ?? []).join(", ") || "N/A"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{n.podCIDRs.join(", ") || "N/A"}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{n.usage ? `${cores(n.usage.cpu)} / ` : ""}
										{cores(n.allocatable.cpu)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{n.usage ? `${bytes(n.usage.memory)} / ` : ""}
										{bytes(n.allocatable.memory)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{n.podCount} / {n.allocatable.pods ?? "N/A"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{n.kubelet ?? "N/A"}
									</TableCell>
									<TableCell>
										{n.os ?? "N/A"} · {n.kernel ?? ""}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{n.runtime ?? "N/A"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{n.taints.join(", ") || "N/A"}
									</TableCell>
									<TableCell
										className="text-right tabular-nums"
										data-pixel="ignore"
									>
										{ago(n.created, now)}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
		</section>
	);
};
