import { cn } from "cn";
import { TriangleAlertIcon } from "lucide-react";
import type { ClusterNetworkReport, ComponentKind } from "#/api/clusterNetwork";
import type { ClusterNode } from "#/api/platform";
import { Badge } from "#/components/Badge/Badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { bytes } from "#/modules/platform/ClusterVisuals";
import { cores } from "./clusterFormat";
import {
	componentIcon,
	groupByKind,
	KINDS,
	KindLegend,
} from "./componentKinds";
import { useOpenEntity } from "./EntityDetails";
import {
	type KindShare,
	nodesByZone,
	requestsByKind,
	type Spread,
	spreadByKind,
	type TopologyPod,
	topologyPods,
} from "./topology";

const SPREAD_TEXT: Record<Spread["verdict"], string> = {
	spread: "Spread over nodes",
	"one-node": "All on one node",
	single: "One pod",
	cluster: "One node in the cluster",
};

/**
 * Settings > Network, the Nodes card: each Kubernetes node as a box (grouped
 * by zone) with every one of the platform's pods inside the node it runs on,
 * coloured and grouped by kind, and what they request of the node's CPU and
 * memory by kind - so the topology spread of the platform is visible: which
 * replicas share a node, which node is full. A table under it says, per kind,
 * how its pods spread over nodes and zones. Built for many nodes (the dev
 * cluster has one).
 */
/** What a pod is at a glance, beside its colour mark (componentIcon). */
const PodIcon: React.FC<{ kind: ComponentKind; name: string }> = ({
	kind,
	name,
}) => {
	const Icon = componentIcon(kind, name);
	return (
		<Icon
			aria-hidden
			className="size-3 shrink-0 text-(--kind)"
			data-testid="component-icon"
		/>
	);
};

export const NodesTopologyCard: React.FC<{ report: ClusterNetworkReport }> = ({
	report,
}) => {
	const pods = topologyPods(report);
	const zones = nodesByZone(report.nodes);
	const unscheduled = pods.filter(
		(p) => !p.node || !report.nodes.some((n) => n.name === p.node),
	);
	const spread = spreadByKind(pods, report.nodes);
	const zoneCount = zones.filter(([z]) => z).length;

	return (
		<section
			aria-labelledby="cluster-topology"
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
			data-testid="cluster-nodes-card"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="cluster-topology" className="m-0 text-base font-semibold">
					Node topology
				</h2>
				<span className="text-xs text-content-secondary">
					{report.nodes.length} {report.nodes.length === 1 ? "node" : "nodes"}
					{zoneCount
						? ` in ${zoneCount} ${zoneCount === 1 ? "zone" : "zones"}`
						: ""}
				</span>
			</div>
			<p className="m-0 text-sm text-content-secondary">
				Every component of the platform inside the node it runs on. Each bar is
				a node's allocatable CPU or memory: what each kind requests, and in grey
				what the node's other pods request.
			</p>
			<KindLegend kinds={pods.map((p) => p.kind)} />
			{zones.map(([zone, nodes]) => (
				<div key={zone ?? "none"} className="flex flex-col gap-2">
					{(zones.length > 1 || zone) && (
						<h3 className="m-0 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
							{zone ? `Zone ${zone}` : "No zone label"}
						</h3>
					)}
					<div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
						{nodes.map((n) => (
							<NodeBox key={n.name} node={n} pods={pods} />
						))}
					</div>
				</div>
			))}
			{unscheduled.length > 0 && (
				<div className="rounded-lg border border-dashed border-content-warning p-3">
					<p className="m-0 mb-2 text-xs font-semibold">
						Not on a node yet ({unscheduled.length})
					</p>
					<PodBlocks pods={unscheduled} />
				</div>
			)}
			{spread.length > 0 && <SpreadTable spread={spread} />}
		</section>
	);
};

const NodeBox: React.FC<{
	node: ClusterNode;
	pods: readonly TopologyPod[];
}> = ({ node: n, pods }) => {
	const open = useOpenEntity();
	const mine = pods.filter((p) => p.node === n.name);
	const shares = requestsByKind(n, pods);
	const status = !n.ready
		? ["destructive", "Not ready"]
		: n.unschedulable
			? ["warning", "Cordoned"]
			: n.pressure.length
				? ["warning", n.pressure.join(", ")]
				: ["green", "Ready"];
	return (
		<article
			aria-label={`Node ${n.name}`}
			className={cn(
				"flex min-w-0 flex-col gap-3 rounded-[10px] border border-solid p-3.5",
				n.ready ? "border-border" : "border-content-destructive",
			)}
			data-testid={`topology-node-${n.name}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<button
					type="button"
					onClick={() => open({ type: "node", name: n.name })}
					className="cursor-pointer border-0 bg-transparent p-0 text-[15px] font-semibold text-content-primary hover:underline"
				>
					{n.name}
				</button>
				<Badge
					size="xs"
					variant={status[0] as "destructive" | "warning" | "green"}
				>
					{status[1]}
				</Badge>
			</div>
			<div className="text-xs text-content-secondary">
				{[
					n.roles.join(", "),
					n.instanceType,
					n.zone,
					`${mine.length} of the platform's pods`,
				]
					.filter(Boolean)
					.join(" · ")}
			</div>
			<RequestBar
				label="CPU"
				shares={shares}
				requested={n.requests.cpu}
				total={n.allocatable.cpu}
				pick={(k) => k.cpu}
				format={cores}
			/>
			<RequestBar
				label="Memory"
				shares={shares}
				requested={n.requests.memory}
				total={n.allocatable.memory}
				pick={(k) => k.memory}
				format={bytes}
			/>
			{mine.length ? (
				<PodBlocks pods={mine} />
			) : (
				<p className="m-0 text-xs text-content-secondary">
					None of the platform's pods.
				</p>
			)}
		</article>
	);
};

/**
 * What the node's pods request of one resource, as one bar of its
 * allocatable: a segment per kind (2px apart) and the node's other pods in
 * grey; the total beside it turns red from 90%.
 */
const RequestBar: React.FC<{
	label: string;
	shares: KindShare[];
	requested: number;
	total: number | null;
	pick: (s: KindShare) => number;
	format: (v: number) => string;
}> = ({ label, shares, requested, total, pick, format }) => {
	const parts = shares.filter((s) => pick(s) > 0);
	const share = total ? (requested / total) * 100 : null;
	const hot = share !== null && share >= 90;
	const name = (s: KindShare) =>
		s.kind === "rest"
			? "other pods (not the platform's)"
			: KINDS[s.kind].plural;
	return (
		<div
			role="img"
			aria-label={`${label} requested: ${format(requested)} of ${total ? format(total) : "N/A"} allocatable; ${parts.map((s) => `${name(s)} ${format(pick(s))}`).join(", ")}`}
			className="grid grid-cols-[58px_minmax(0,1fr)_minmax(7.5rem,auto)] items-center gap-2 text-xs"
		>
			<span>{label}</span>
			<span className="flex h-2 gap-0.5 overflow-hidden rounded bg-surface-tertiary">
				{total
					? parts.map((s) => (
							<span
								key={s.kind}
								title={`${name(s)}: ${format(pick(s))} requested (${Math.round((pick(s) / total) * 100)}% of ${format(total)})`}
								className={cn(
									"h-full shrink-0",
									s.kind === "rest"
										? "bg-content-secondary/40"
										: ["bg-(--kind)", KINDS[s.kind].color],
								)}
								style={{ width: `${Math.min(100, (pick(s) / total) * 100)}%` }}
							/>
						))
					: null}
			</span>
			<span
				className={cn(
					"whitespace-nowrap text-right tabular-nums",
					hot ? "text-content-destructive" : "text-content-secondary",
				)}
			>
				{format(requested)} / {total ? format(total) : "N/A"}
				{hot ? " · full" : ""}
			</span>
		</div>
	);
};

/** A node's pods, grouped by kind under the kind's name; each opens its panel. */
const PodBlocks: React.FC<{ pods: readonly TopologyPod[] }> = ({ pods }) => {
	const open = useOpenEntity();
	return (
		<div className="flex flex-col gap-2">
			{groupByKind(pods, (p) => p.kind).map(([kind, list]) => (
				<div key={kind} className="flex flex-col gap-1">
					<span className="text-[11px] text-content-secondary">
						{KINDS[kind].plural} ({list.length})
					</span>
					<div className="flex flex-wrap gap-1">
						{list.map((p) => (
							<button
								key={`${p.namespace}/${p.name}`}
								type="button"
								onClick={() => open(p.ref)}
								title={`${p.label} (${KINDS[kind].label})${p.role ? ` · ${p.role}` : ""}\n${p.ready ? "ready" : "not ready"}${p.requests ? ` · requests ${cores(p.requests.cpu)} CPU, ${bytes(p.requests.memory)}` : ""}`}
								className={cn(
									"inline-flex max-w-full cursor-pointer items-center gap-1 rounded border border-solid border-border bg-surface-secondary py-0.5 pr-1.5 pl-1 text-[11px] leading-tight hover:bg-surface-tertiary",
									KINDS[kind].color,
									!p.ready && "border-dashed border-content-warning",
								)}
								data-testid={`topology-pod-${p.name}`}
								data-kind={kind}
							>
								<i
									aria-hidden
									className="h-3 w-1 shrink-0 rounded-sm bg-(--kind)"
								/>
								<PodIcon kind={kind} name={p.name} />
								<span className="truncate">{p.label}</span>
								{p.role && (
									<span className="text-content-secondary">{p.role}</span>
								)}
								{!p.ready && (
									<TriangleAlertIcon
										aria-label="not ready"
										className="size-3 shrink-0 text-content-warning"
									/>
								)}
							</button>
						))}
					</div>
				</div>
			))}
		</div>
	);
};

const SpreadTable: React.FC<{ spread: Spread[] }> = ({ spread }) => (
	<div className="overflow-x-auto">
		<Table aria-label="Spread by kind" data-testid="topology-spread">
			<TableHeader>
				<TableRow>
					{["Kind", "Pods", "Nodes", "Zones", "Spread"].map((h) => (
						<TableHead key={h}>{h}</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{spread.map((s) => (
					<TableRow key={s.kind}>
						<TableCell>
							<span
								className={cn(
									"inline-flex items-center gap-1.5",
									KINDS[s.kind].color,
								)}
							>
								<i aria-hidden className="size-2.5 rounded-[3px] bg-(--kind)" />
								{KINDS[s.kind].plural}
							</span>
						</TableCell>
						<TableCell className="tabular-nums">{s.pods}</TableCell>
						<TableCell className="font-mono text-xs">
							{s.nodes.join(", ") || "N/A"}
						</TableCell>
						<TableCell className="font-mono text-xs">
							{s.zones.join(", ") || "N/A"}
						</TableCell>
						<TableCell
							className={cn(
								"text-xs",
								s.verdict === "one-node" && "text-content-warning",
							)}
						>
							{SPREAD_TEXT[s.verdict]}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	</div>
);
