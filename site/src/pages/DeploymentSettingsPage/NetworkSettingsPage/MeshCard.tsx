import { cn } from "cn";
import { useQuery } from "react-query";
import {
	clusterMesh,
	type MeshEdge,
	type MeshNode,
	type MeshReport,
} from "#/api/clusterNetwork";
import { Loader } from "#/components/Loader/Loader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { ago, LiveStatus, useNow } from "#/modules/platform/ClusterVisuals";
import { formatMs } from "./clusterFormat";
import { componentIcon, KINDS, KindLegend } from "./componentKinds";
import { useOpenEntity } from "./EntityDetails";
import { layoutMesh, NODE_H, NODE_W, PLATFORM_W } from "./meshLayout";

/** What an edge's label says: the number, "failed" for a measurement that failed, "—" for none possible. */
export const edgeLabel = (e: MeshEdge) =>
	e.ms != null ? formatMs(e.ms) : e.measuredBy ? "failed" : "—";

/** The hover text: how it is measured (and by whom, when), or why it is not. */
export const edgeHint = (e: MeshEdge, names: Record<string, string>) =>
	[
		`${names[e.from] ?? e.from} → ${names[e.to] ?? e.to}`,
		e.ms != null
			? `${formatMs(e.ms)}, measured by ${e.measuredBy}`
			: e.measuredBy
				? `No number this time: ${e.error ?? "the measurement failed"}`
				: "No number",
		`How: ${e.method}`,
		e.note ?? "",
	]
		.filter(Boolean)
		.join("\n");

/**
 * Settings > Network, the Mesh card: the connections between the platform's
 * components drawn as a graph, each labelled with a latency measured now - by
 * the platform service itself (TCP connects, HTTP health requests, a SQL
 * round trip), by Coder's health check, or by the workspace agents - and,
 * where none of them can measure it, drawn without a number with the reason
 * on hover. Measured at most every 8 seconds on the service; re-read every
 * 10 seconds. A click on a connection opens its panel (its last
 * measurements); a click on a component, its Service or pod.
 */
export const MeshCard: React.FC<{ paused: boolean }> = ({ paused }) => {
	const query = useQuery(clusterMesh(paused));
	return (
		<section
			aria-labelledby="cluster-mesh"
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
			data-testid="cluster-mesh-card"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="cluster-mesh" className="m-0 text-base font-semibold">
					Mesh
				</h2>
				<LiveStatus paused={paused} updatedAt={query.dataUpdatedAt} />
			</div>
			<p className="m-0 text-sm text-content-secondary">
				The platform's connections, each with a latency measured now: by the
				platform service itself, by Coder's health check, or by the workspace
				agents. A connection seen only inside another pod is drawn without a
				number; hover it for why.
			</p>
			{query.isLoading ? (
				<Loader />
			) : query.error ? (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					The mesh could not be measured:{" "}
					{query.error instanceof Error ? query.error.message : "unknown error"}
				</p>
			) : query.data ? (
				<MeshView report={query.data} />
			) : null}
		</section>
	);
};

export const MeshView: React.FC<{ report: MeshReport }> = ({ report }) => {
	const open = useOpenEntity();
	const now = useNow();
	const layout = layoutMesh(report);
	const names = Object.fromEntries(report.nodes.map((n) => [n.id, n.label]));
	const openEdge = (e: MeshEdge) => open({ type: "link", id: e.id });

	return (
		<>
			<p
				className="m-0 text-xs text-content-secondary tabular-nums"
				data-pixel="ignore"
			>
				Measured {ago(report.generatedAt, now)} ago
				{report.vantage ? ` from ${report.vantage}` : ""} · at most every{" "}
				{report.ttlSeconds} s
			</p>
			<div className="overflow-x-auto">
				<svg
					viewBox={`0 0 ${layout.width} ${layout.height}`}
					className="block h-auto w-full min-w-[720px]"
					role="group"
					aria-label="The platform's connections and their latency"
					data-testid="mesh-graph"
				>
					{layout.edges.map(({ edge: e, d, label }) => {
						const measurable = e.measuredBy !== null;
						return (
							<g
								key={e.id}
								role="button"
								tabIndex={0}
								aria-label={edgeHint(e, names).replaceAll("\n", ". ")}
								className="group cursor-pointer outline-none"
								onClick={() => openEdge(e)}
								onKeyDown={(ev) => {
									if (ev.key === "Enter" || ev.key === " ") {
										ev.preventDefault();
										openEdge(e);
									}
								}}
								data-testid={`mesh-edge-${e.id}`}
								data-measured={
									e.ms != null ? "yes" : measurable ? "failed" : "no"
								}
							>
								<title>{edgeHint(e, names)}</title>
								<path
									d={d}
									fill="none"
									strokeWidth={2}
									strokeDasharray={
										e.kind === "control"
											? "2 4"
											: !measurable
												? "6 5"
												: e.kind === "probe"
													? "1 0"
													: undefined
									}
									className={cn(
										"transition-[stroke-width] group-hover:stroke-[3] group-focus-visible:stroke-[3]",
										e.ms == null && measurable
											? "stroke-content-destructive/70"
											: e.kind === "probe"
												? "stroke-content-link/55"
												: "stroke-content-secondary/60",
									)}
								/>
								{/* A wider, invisible line: easier to hover and click. */}
								<path d={d} fill="none" stroke="transparent" strokeWidth={14} />
								<EdgeLabel
									x={label.x}
									y={label.y}
									text={edgeLabel(e)}
									state={e.ms != null ? "ok" : measurable ? "failed" : "none"}
									id={e.id}
								/>
							</g>
						);
					})}
					{layout.nodes.map(({ node, x, y }) => (
						<MeshNodeBox
							key={node.id}
							node={node}
							x={x}
							y={y}
							onOpen={
								node.entity ? () => node.entity && open(node.entity) : undefined
							}
						/>
					))}
				</svg>
			</div>
			<div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-content-secondary">
				<KindLegend kinds={report.nodes.map((n) => n.kind)} />
				<span className="inline-flex items-center gap-1.5">
					<i className="w-5.5 border-0 border-t-2 border-solid border-content-secondary/60" />
					Between components
				</span>
				<span className="inline-flex items-center gap-1.5">
					<i className="w-5.5 border-0 border-t-2 border-solid border-content-link/55" />
					Platform service's own measurement
				</span>
				<span className="inline-flex items-center gap-1.5">
					<i className="w-5.5 border-0 border-t-2 border-dashed border-content-secondary/60" />
					Not measurable from here (—)
				</span>
			</div>
			<MeshTable report={report} names={names} onOpen={openEdge} />
		</>
	);
};

const EdgeLabel: React.FC<{
	x: number;
	y: number;
	text: string;
	state: "ok" | "failed" | "none";
	id: string;
}> = ({ x, y, text, state, id }) => {
	const w = Math.max(28, text.length * 6.4 + 12);
	return (
		<g transform={`translate(${x},${y})`}>
			<rect
				x={-w / 2}
				y={-9}
				width={w}
				height={18}
				rx={9}
				className={cn(
					"fill-surface-primary stroke-border",
					state === "failed" && "stroke-content-destructive",
				)}
				strokeWidth={1}
			/>
			<text
				textAnchor="middle"
				dominantBaseline="central"
				className={cn(
					"text-[11px] font-medium tabular-nums",
					state === "ok"
						? "fill-content-primary"
						: state === "failed"
							? "fill-content-destructive"
							: "fill-content-secondary",
				)}
				data-testid={`mesh-edge-label-${id}`}
			>
				{text}
			</text>
		</g>
	);
};

const MeshNodeBox: React.FC<{
	node: MeshNode;
	x: number;
	y: number;
	onOpen?: () => void;
}> = ({ node, x, y, onOpen }) => {
	const count = node.pods.length;
	const w = node.id === "platform" ? PLATFORM_W : NODE_W;
	const Icon = componentIcon(node.kind, `${node.id} ${node.label}`);
	const sub =
		count > 0
			? `${node.ready}/${count} ready${node.sub ? ` · ${node.sub}` : ""}`
			: (node.sub ?? "");
	const box = (
		<>
			<title>
				{`${node.label} (${KINDS[node.kind].label})${count ? `\n${node.pods.map((p) => `${p.name}${p.ready ? "" : " (not ready)"}`).join("\n")}` : ""}`}
			</title>
			<rect
				x={x - w / 2}
				y={y - NODE_H / 2}
				width={w}
				height={NODE_H}
				rx={8}
				strokeWidth={1.5}
				className={cn(
					"fill-surface-secondary stroke-(--kind)",
					KINDS[node.kind].color,
					count > 0 && node.ready < count && "[stroke-dasharray:4_3]",
				)}
			/>
			<rect
				x={x - w / 2 + 5}
				y={y - NODE_H / 2 + 6}
				width={3}
				height={NODE_H - 12}
				rx={1.5}
				className={cn("fill-(--kind)", KINDS[node.kind].color)}
			/>
			{/* Platform: what it is at a glance, right of its colour strip (componentIcon), as on the map */}
			<Icon
				x={x - w / 2 + 13}
				y={y - 7}
				width={14}
				height={14}
				aria-hidden
				data-testid="component-icon"
				className={cn("text-(--kind)", KINDS[node.kind].color)}
			/>
			<text
				x={x - w / 2 + 32}
				y={y - 5}
				className="fill-content-primary text-[12px] font-semibold"
			>
				{node.label}
			</text>
			<text
				x={x - w / 2 + 32}
				y={y + 11}
				className="fill-content-secondary text-[10px]"
			>
				{sub.length > (w - 38) / 5.6
					? `${sub.slice(0, Math.floor((w - 38) / 5.6) - 1)}…`
					: sub}
			</text>
		</>
	);
	return onOpen ? (
		<g
			role="button"
			tabIndex={0}
			aria-label={`${node.label}: ${sub}`}
			className="cursor-pointer outline-none [&:focus-visible>rect:first-of-type]:stroke-[3]"
			onClick={onOpen}
			onKeyDown={(ev) => {
				if (ev.key === "Enter" || ev.key === " ") {
					ev.preventDefault();
					onOpen();
				}
			}}
			data-testid={`mesh-node-${node.id}`}
		>
			{box}
		</g>
	) : (
		<g data-testid={`mesh-node-${node.id}`}>{box}</g>
	);
};

const MeshTable: React.FC<{
	report: MeshReport;
	names: Record<string, string>;
	onOpen: (e: MeshEdge) => void;
}> = ({ report, names, onOpen }) => {
	const now = useNow();
	return (
		<div className="overflow-x-auto">
			<Table aria-label="Connections" data-testid="mesh-table">
				<TableHeader>
					<TableRow>
						{["Connection", "Latency", "Measured by", "How, or why not"].map(
							(h) => (
								<TableHead key={h}>{h}</TableHead>
							),
						)}
					</TableRow>
				</TableHeader>
				<TableBody>
					{report.edges.map((e) => (
						<TableRow key={e.id}>
							<TableCell className="whitespace-nowrap">
								<button
									type="button"
									onClick={() => onOpen(e)}
									className="cursor-pointer border-0 bg-transparent p-0 text-left text-content-link hover:underline"
								>
									{names[e.from] ?? e.from} → {names[e.to] ?? e.to}
								</button>
							</TableCell>
							<TableCell
								className={cn(
									"whitespace-nowrap text-right tabular-nums",
									e.ms == null && e.measuredBy && "text-content-destructive",
									e.ms == null && !e.measuredBy && "text-content-secondary",
								)}
							>
								{edgeLabel(e)}
							</TableCell>
							<TableCell className="whitespace-nowrap text-xs">
								{e.measuredBy ? (
									<>
										{e.measuredBy}
										{e.measuredAt && (
											<span
												className="text-content-secondary"
												data-pixel="ignore"
											>
												{" "}
												· {ago(e.measuredAt, now)} ago
											</span>
										)}
									</>
								) : (
									<span className="text-content-secondary">Not measurable</span>
								)}
							</TableCell>
							<TableCell className="min-w-[260px] text-xs text-content-secondary">
								{e.ms == null && e.error ? (
									<span className="text-content-destructive">{e.error}. </span>
								) : null}
								{e.ms == null && e.note ? e.note : e.method}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
};
