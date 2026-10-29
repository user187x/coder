import { cn } from "cn";
import { TriangleAlertIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "react-query";
import type {
	ClusterNetworkReport,
	ComponentKind,
	MapService,
} from "#/api/clusterNetwork";
import type { ClusterNode, NetworkWorkspace } from "#/api/platform";
import { networkReport } from "#/api/queries/platform";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "#/components/Dialog/Dialog";
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
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import {
	ago,
	bytes,
	LiveStatus,
	Meter,
	StatusDot,
	Tile,
	useNow,
} from "#/modules/platform/ClusterVisuals";
import "./clusterMap.css";
import { CoderReplicas } from "./CoderReplicas";
import { CodeServerHACard } from "./CodeServerHACard";
import { cores, nodeBadgeStyle } from "./clusterFormat";
import {
	componentIcon,
	groupByKind,
	KINDS,
	KindLegend,
	kindOf,
} from "./componentKinds";
import { EntityProvider, useOpenEntity } from "./EntityDetails";
import { MeshCard } from "./MeshCard";
import { NodesTopologyCard } from "./NodesTopologyCard";

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

/**
 * General > Network (top of the page): a live map of the Kubernetes cluster
 * Coder runs on. Every node with its addresses, pod CIDR, CPU and memory
 * (live usage when metrics-server runs, else the pods' requests) and the
 * platform's pods and workspaces placed on it, each coloured by its kind, and
 * the Services; lines show the way in (access URL to Coder) and each
 * workspace agent's connection. Any pod, Service, node or line opens its
 * details. Under the map: code-server HA and the storage, the mesh of
 * measured latencies, and the nodes' topology. Re-read every 5 seconds (the
 * cards every 10); Pause stops them all.
 */
export const ClusterMap: React.FC = () => {
	const [paused, setPaused] = useState(false);
	const query = useQuery(networkReport(paused));
	// The service adds kinds, roles, requests and Services to the report (clusternet.py).
	const report = query.data as ClusterNetworkReport | undefined;

	return (
		<EntityProvider>
			<section>
				<SettingsHeader>
					<SettingsHeaderTitle>Cluster Network</SettingsHeaderTitle>
					<SettingsHeaderDescription>
						A live map of the Kubernetes cluster Coder runs on: nodes, their
						addresses and load, the platform's pods and the workspaces on each.
						Click any pod, Service, node or line for its details. Refreshes
						every 5 seconds.
					</SettingsHeaderDescription>
				</SettingsHeader>
				{query.isLoading ? (
					<Loader />
				) : (
					<div className="flex flex-col gap-6">
						<section
							aria-labelledby="cluster-map"
							className="flex flex-col gap-5 rounded-lg border border-solid border-border p-6"
							data-testid="cluster-map"
						>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<h2 id="cluster-map" className="m-0 text-base font-semibold">
									Cluster map
								</h2>
								<div className="flex items-center gap-3">
									<LiveStatus paused={paused} updatedAt={query.dataUpdatedAt} />
									{report && (
										<Dialog>
											<DialogTrigger asChild>
												<Button size="sm" variant="outline">
													Focus view
												</Button>
											</DialogTrigger>
											<DialogContent className="h-[95vh] max-h-[95vh] w-[96vw] max-w-none content-start">
												<div className="flex items-center justify-between gap-3">
													<DialogTitle>Cluster network focus view</DialogTitle>
													<DialogClose asChild>
														<Button variant="outline">Close focus view</Button>
													</DialogClose>
												</div>
												<DialogDescription>
													Filter nodes to reduce clutter. Connections to hidden
													nodes are omitted. Live refresh follows the map's
													Pause setting.
												</DialogDescription>
												{query.error && (
													<p role="alert" className="text-content-destructive">
														Updates unavailable. Showing the last received
														report.
													</p>
												)}
												<EntityProvider>
													<Topology report={report} focus />
												</EntityProvider>
											</DialogContent>
										</Dialog>
									)}
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
								<p
									role="alert"
									className="m-0 text-sm text-content-destructive"
								>
									The cluster could not be read:{" "}
									{query.error instanceof Error
										? query.error.message
										: "unknown error"}
								</p>
							) : null}
							{report && <Topology report={report} />}
						</section>
						<CoderReplicas />
						<CodeServerHACard paused={paused} />
						<MeshCard paused={paused} />
						{report && <NodesTopologyCard report={report} />}
						{report && <WorkspacesTable report={report} />}
						{report && <NodesTable report={report} />}
					</div>
				)}
			</section>
		</EntityProvider>
	);
};

const Tiles: React.FC<{ report: ClusterNetworkReport }> = ({ report: d }) => {
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

type LinkPath = {
	kind: "entry" | "ok" | "bad";
	d: string;
	/** The connection a click opens: the mesh's way in, or a workspace's agents (agent:<id>). */
	id: string;
	/** Unique per line (one way-in line per Coder server). */
	testId: string;
	label: string;
};

/**
 * Logical entrance routes through discovered gateway pods, and from a Coder server to
 * every workspace (its agent's connection), measured from the drawn cards.
 */
const useLinks = (
	container: React.RefObject<HTMLDivElement | null>,
	report: ClusterNetworkReport,
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
			const servers = [
				...root.querySelectorAll<HTMLElement>("[data-coder-server]"),
			];
			const gateways = [
				...root.querySelectorAll<HTMLElement>("[data-gateway-pod]"),
			];
			const entrancePath = (
				from: Element,
				to: Element,
				key: string,
				label: string,
			) => {
				const [x1, y1] = at(from, "right");
				const [x2, y2] = at(to, "left");
				const dx = Math.max(30, Math.abs(x2 - x1) / 2);
				next.push({
					kind: [from, to].some(
						(el) => el.getAttribute("data-route-ready") === "false",
					)
						? "bad"
						: "entry",
					d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
					id: "gateway-coder",
					testId: key,
					label: `${label}${[from, to].some((el) => el.getAttribute("data-route-ready") === "false") ? " (endpoint unhealthy)" : ""}`,
				});
			};
			if (entry) {
				for (const gateway of gateways) {
					entrancePath(
						entry,
						gateway,
						`entry-${gateway.dataset.gatewayPod}`,
						`Entrance route → ${gateway.dataset.gatewayPod}`,
					);
				}
				for (const server of servers) {
					for (const source of gateways.length ? gateways : [entry]) {
						const name =
							source instanceof HTMLElement
								? source.dataset.gatewayPod
								: undefined;
						entrancePath(
							source,
							server,
							`gateway-coder-${name ?? "entry"}-${server.dataset.coderServer}`,
							`Entrance route: ${name ?? "The way in"} → ${server.dataset.coderServer}`,
						);
					}
				}
			}
			const hub =
				servers.find((server) => server.dataset.haRole === "active") ??
				servers[0];
			if (hub) {
				for (const ws of root.querySelectorAll<HTMLElement>(
					"[data-workspace]",
				)) {
					const [hx, hy] = at(hub, "top");
					const [wx, wy] = at(ws, "top");
					const lift = Math.min(hy, wy) - 18;
					next.push({
						kind:
							ws.dataset.workspace === "ok" &&
							hub.dataset.routeReady !== "false"
								? "ok"
								: "bad",
						d: `M${hx},${hy} C${hx},${lift} ${wx},${lift} ${wx},${wy}`,
						id: `agent:${ws.dataset.workspaceId}`,
						testId: `agent-${ws.dataset.workspaceId}`,
						label: `Coder → ${ws.dataset.label ?? "workspace"}`,
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

const Topology: React.FC<{ report: ClusterNetworkReport; focus?: boolean }> = ({
	report,
	focus = false,
}) => {
	const [nodeFilter, setNodeFilter] = useState("");
	const visibleReport = useMemo(
		() => ({
			...report,
			nodes: report.nodes.filter((node) =>
				node.name.toLowerCase().includes(nodeFilter.toLowerCase()),
			),
		}),
		[report, nodeFilter],
	);
	const container = useRef<HTMLDivElement>(null);
	const { paths, box } = useLinks(container, visibleReport);
	const animations = useAnimationsEnabled();
	const open = useOpenEntity();
	const now = useNow();
	let host = report.accessUrl;
	try {
		host = new URL(report.accessUrl).host;
	} catch {
		// Keep it as it is.
	}
	const services = report.services ?? [];
	const gateway = services.find((s) => s.kind === "gateway");
	const kinds: ComponentKind[] = [
		...report.coder.map((p) => kindOf(p)),
		...services.map((s) => s.kind),
		...(report.workspaces.length ? ["workspace" as const] : []),
	];

	return (
		<>
			<Tiles report={report} />
			{focus && (
				<label className="flex items-center gap-3 text-sm">
					Filter nodes
					<input
						aria-label="Filter nodes"
						value={nodeFilter}
						onChange={(event) => setNodeFilter(event.target.value)}
						placeholder="Node name…"
						className="rounded-md border border-border bg-surface-secondary px-3 py-2 text-content-primary"
					/>
					<span>
						{visibleReport.nodes.length} of {report.nodes.length} nodes shown
					</span>
				</label>
			)}
			<div
				ref={container}
				className="relative grid items-start gap-14 md:grid-cols-[minmax(180px,220px)_minmax(0,1fr)]"
			>
				<svg
					className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible"
					viewBox={`0 0 ${box.width} ${box.height}`}
					role="group"
					aria-label="Connections on the map"
				>
					{paths.map((path) => (
						<g key={path.testId}>
							<path
								aria-hidden
								d={path.d}
								fill="none"
								strokeWidth={2}
								strokeDasharray={path.kind === "bad" ? "5 5" : undefined}
								className={cn(
									path.kind === "entry"
										? "stroke-content-link/60"
										: path.kind === "ok"
											? "stroke-content-success/70"
											: "stroke-content-destructive [filter:drop-shadow(0_0_3px_currentColor)] text-content-destructive",
								)}
							/>
							{[25, 75].map((position) => (
								<path
									key={position}
									aria-hidden
									d="M -4 -3 L 0 0 L -4 3"
									fill="none"
									stroke="currentColor"
									strokeWidth={2}
									strokeLinecap="round"
									strokeLinejoin="round"
									className={cn(
										"cluster-map-direction",
										path.kind === "entry"
											? "text-content-link"
											: path.kind === "ok"
												? "text-content-success"
												: "text-content-destructive",
									)}
									data-moving={animations && path.kind !== "bad"}
									style={{
										offsetPath: `path("${path.d}")`,
										offsetDistance: `${position}%`,
										animationDelay: `${-position / 25}s`,
									}}
								/>
							))}
							{/* The same line, invisible and wider, to click (the cards stay above it). */}
							<path
								d={path.d}
								fill="none"
								stroke="transparent"
								strokeWidth={14}
								role="button"
								tabIndex={0}
								aria-label={path.label}
								className="pointer-events-[stroke] cursor-pointer outline-none focus-visible:stroke-content-link/30"
								onClick={() => open({ type: "link", id: path.id })}
								onKeyDown={(ev) => {
									if (ev.key === "Enter" || ev.key === " ") {
										ev.preventDefault();
										open({ type: "link", id: path.id });
									}
								}}
								data-testid={`cluster-map-link-${path.testId}`}
							>
								<title>{path.label}</title>
							</path>
						</g>
					))}
				</svg>
				<div
					data-entry=""
					className="relative z-[1] grid grid-cols-[minmax(0,1fr)] gap-2.5 rounded-lg border border-dashed border-border p-3.5"
				>
					<div className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
						Way in
					</div>
					<div className="font-semibold break-all">{host || "Access URL"}</div>
					<div className="text-xs text-content-secondary">
						Browsers and CLIs reach Coder here (Gateway → Service). Workspace
						agents dial back to Coder the same way. Blue lines show logical
						routes through discovered ingress pods, not measured traffic or
						individual requests. Dashed red routes indicate an unhealthy pod or
						node, or a disconnected workspace agent. Readiness updates every
						five seconds; network failures may take longer to be detected.
					</div>
					{gateway && (
						<ServiceChip
							svc={gateway}
							testId="cluster-map-way-in-service"
							onOpen={() =>
								open({
									type: "service",
									namespace: gateway.namespace,
									name: gateway.name,
								})
							}
						/>
					)}
				</div>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
					{visibleReport.nodes.map((node) => (
						<NodeCard key={node.name} node={node} report={report} now={now} />
					))}
				</div>
			</div>
			{services.length > 0 && <ServicesStrip services={services} />}
			{report.servicesError && (
				<p className="m-0 text-xs text-content-warning">
					Some Services could not be read: {report.servicesError}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-x-4.5 gap-y-1.5 text-xs text-content-secondary">
				<KindLegend kinds={kinds} />
				<span className="inline-flex items-center gap-1.5">
					<i className="w-5.5 border-0 border-t-2 border-solid border-content-success/70" />
					Agent connected
				</span>
				<span className="inline-flex items-center gap-1.5">
					<i className="w-5.5 border-0 border-t-2 border-dashed border-content-warning/80" />
					Agent not connected
				</span>
				<span className="inline-flex items-center gap-1.5">
					<TriangleAlertIcon className="size-3 text-content-warning" />
					Not ready
				</span>
			</div>
		</>
	);
};

type ChipProps = {
	kind: ComponentKind;
	name: string;
	sub?: string | null;
	title: string;
	/** Not ok: a warning sign beside the name (the colour is the kind's, never the state's). */
	status?: "ok" | "warn" | "error";
	onOpen: () => void;
} & Omit<React.ComponentProps<"button">, "title" | "onClick">;

const Chip: React.FC<ChipProps> = ({
	kind,
	name,
	sub,
	title,
	status = "ok",
	onOpen,
	className,
	...attrs
}) => {
	const Icon = componentIcon(kind, name);
	return (
		<button
			type="button"
			title={title}
			onClick={onOpen}
			className={cn(
				"relative inline-flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-md border border-solid border-border bg-surface-secondary py-1.5 pr-2.5 pl-3 text-left text-xs leading-tight text-content-primary hover:bg-surface-tertiary",
				"before:absolute before:top-1 before:bottom-1 before:left-0 before:w-[3px] before:rounded-sm before:bg-(--kind) before:content-['']",
				KINDS[kind].color,
				status !== "ok" &&
					"border-dashed border-content-destructive shadow-[0_0_10px_var(--color-content-destructive)]",
				className,
			)}
			data-kind={kind}
			{...attrs}
		>
			{/* Platform: what it is at a glance, just right of its colour mark (componentIcon) */}
			<Icon
				aria-hidden
				className="size-4 shrink-0 text-(--kind)"
				data-testid="component-icon"
				data-icon={Icon.displayName}
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-px">
				<b className="flex w-full min-w-0 max-w-full items-center gap-1 font-semibold">
					<span className="truncate">{name}</span>
					{status !== "ok" && (
						<TriangleAlertIcon
							aria-label={status === "error" ? "failing" : "not ready"}
							className="size-3 shrink-0 text-content-destructive"
						/>
					)}
				</b>
				{sub && (
					// Platform: as wide as the chip at most (a button's flex item keeps its text's width otherwise), so it
					// truncates
					<small className="w-full min-w-0 max-w-full truncate font-mono text-[11px] text-content-secondary">
						{sub}
					</small>
				)}
			</span>
		</button>
	);
};

const serviceStatus = (s: MapService): "ok" | "warn" | "error" =>
	s.endpoints == null || s.ready == null
		? "ok"
		: s.ready === 0
			? "error"
			: s.ready < s.endpoints
				? "warn"
				: "ok";

const ServiceChip: React.FC<{
	svc: MapService;
	onOpen: () => void;
	testId?: string;
}> = ({ svc: s, onOpen, testId }) => (
	<Chip
		kind={s.kind}
		name={s.name}
		sub={[
			s.clusterIP && s.clusterIP !== "None" ? s.clusterIP : null,
			s.ports.join(" "),
		]
			.filter(Boolean)
			.join(" · ")}
		status={serviceStatus(s)}
		onOpen={onOpen}
		title={`Service ${s.namespace}/${s.name} (${s.type}, ${KINDS[s.kind].label})\n${s.ports.join(", ")}${s.external.length ? `\nexternal ${s.external.join(", ")}` : ""}\n${s.endpoints == null ? "endpoints not readable" : `${s.ready} of ${s.endpoints} endpoints ready`}`}
		data-testid={testId ?? `cluster-map-service-${s.namespace}-${s.name}`}
	/>
);

/** The Services, grouped by the kind of what they select. */
const ServicesStrip: React.FC<{ services: MapService[] }> = ({ services }) => {
	const open = useOpenEntity();
	return (
		<div className="flex flex-col gap-2" data-testid="cluster-map-services">
			<p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
				Services ({services.length})
			</p>
			<div className="flex flex-wrap gap-x-5 gap-y-2.5">
				{groupByKind(services, (s) => s.kind).map(([kind, list]) => (
					<div key={kind} className="flex min-w-0 flex-col gap-1">
						<span className="text-[11px] text-content-secondary">
							{KINDS[kind].plural}
						</span>
						<div className="flex flex-wrap gap-1.5">
							{list.map((s) => (
								<ServiceChip
									key={`${s.namespace}/${s.name}`}
									svc={s}
									onOpen={() =>
										open({
											type: "service",
											namespace: s.namespace,
											name: s.name,
										})
									}
								/>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
};

type NodeCardProps = {
	node: ClusterNode;
	report: ClusterNetworkReport;
	now: number;
};

const NodeCard: React.FC<NodeCardProps> = ({ node: n, report, now }) => {
	const open = useOpenEntity();
	const platform = report.coder.filter((p) => p.node === n.name);
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
				"relative z-[1] grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 rounded-[10px] border border-solid px-4 py-3.5",
				n.ready ? "border-border" : "border-content-destructive",
			)}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<button
					type="button"
					onClick={() => open({ type: "node", name: n.name })}
					className="max-w-full cursor-pointer rounded-full border border-solid px-2.5 py-1 text-left text-xs font-semibold [overflow-wrap:anywhere] hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-link"
					style={nodeBadgeStyle(n.name)}
					data-testid={`cluster-map-node-${n.name}`}
				>
					{n.name}
				</button>
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
				title={`CPU: ${cores(n.usage?.cpu)} in use, ${cores(n.requests.cpu)} requested by pods, ${cores(n.allocatable.cpu)} allocatable`}
			/>
			<Meter
				label="Memory"
				value={n.usage?.memory}
				requested={n.requests.memory}
				total={n.allocatable.memory}
				format={bytes}
				title={`Memory: ${bytes(n.usage?.memory)} in use, ${bytes(n.requests.memory)} requested by pods, ${bytes(n.allocatable.memory)} allocatable`}
			/>
			{platform.length > 0 && (
				<div className="flex flex-col gap-2">
					<p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
						Coder and the platform ({platform.length})
					</p>
					{groupByKind(platform, (p) => kindOf(p)).map(([kind, pods]) => (
						<div key={kind} className="flex flex-col gap-1">
							<span className="text-[11px] text-content-secondary">
								{KINDS[kind].plural}
							</span>
							<div className="flex flex-wrap gap-1.5">
								{pods.map((pod) => (
									<Chip
										key={`${pod.namespace}/${pod.name}`}
										kind={kind}
										name={pod.name}
										sub={[pod.podIP, pod.haRole].filter(Boolean).join(" · ")}
										status={pod.ready && n.ready ? "ok" : "warn"}
										className={pod.ready ? undefined : "opacity-75"}
										onOpen={() =>
											open({
												type: "pod",
												namespace: pod.namespace,
												name: pod.name,
											})
										}
										data-route-ready={pod.ready && n.ready}
										data-ha-role={pod.haRole}
										data-coder-server={kind === "coder" ? pod.name : undefined}
										data-gateway-pod={
											kind === "gateway"
												? `${pod.namespace}/${pod.name}`
												: undefined
										}
										data-testid={`cluster-map-pod-${pod.name}`}
										title={`${KINDS[kind].label}${pod.haRole ? ` (${pod.haRole})` : ""} · ${pod.namespace}/${pod.name}\nIP ${pod.podIP ?? "N/A"} · ${pod.ready ? "ready" : "not ready"} · ${pod.restarts} restarts · up ${ago(pod.started, now)}`}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}
			<div>
				<p className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
					Workspaces ({workspaces.length})
				</p>
				{workspaces.length ? (
					<div className="flex flex-wrap gap-1.5">
						{workspaces.map((w) => {
							const ok = agentOk(w) && w.pod.ready && n.ready;
							const agent = w.agents[0];
							return (
								<Chip
									key={w.id}
									kind="workspace"
									name={`${w.owner}/${w.name}`}
									sub={w.pod.podIP}
									status={ok ? "ok" : "warn"}
									onOpen={() =>
										open({
											type: "pod",
											namespace: w.pod.namespace,
											name: w.pod.name,
										})
									}
									data-workspace={ok ? "ok" : "bad"}
									data-workspace-id={w.id}
									data-label={`${w.owner}/${w.name}`}
									data-testid={`cluster-map-pod-${w.pod.name}`}
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

const WorkspacesTable: React.FC<{ report: ClusterNetworkReport }> = ({
	report,
}) => {
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

const NodesTable: React.FC<{ report: ClusterNetworkReport }> = ({ report }) => {
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
