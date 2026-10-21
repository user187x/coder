import type {
	ClusterNetworkReport,
	ComponentKind,
	EntityRef,
} from "#/api/clusterNetwork";
import type { ClusterNode } from "#/api/platform";
import { KIND_ORDER, kindOf } from "./componentKinds";

/** One of the platform's pods, placed on its node. */
export type TopologyPod = {
	name: string;
	namespace: string;
	node: string | null;
	kind: ComponentKind;
	ready: boolean;
	role: string | null;
	requests: { cpu: number; memory: number } | null;
	/** owner/name for a workspace's pod. */
	label: string;
	ref: EntityRef;
};

/** Every pod the map shows (the platform's and the workspaces'), with its kind. */
export const topologyPods = (report: ClusterNetworkReport): TopologyPod[] => [
	...report.coder.map((p) => ({
		name: p.name,
		namespace: p.namespace,
		node: p.node,
		kind: kindOf(p),
		ready: p.ready,
		role: p.haRole ?? null,
		requests: p.requests ?? null,
		label: p.name,
		ref: { type: "pod" as const, namespace: p.namespace, name: p.name },
	})),
	...report.workspaces.map((w) => ({
		name: w.pod.name,
		namespace: w.pod.namespace,
		node: w.pod.node,
		kind: "workspace" as const,
		ready: w.pod.ready,
		role: null,
		requests: w.pod.requests ?? null,
		label: `${w.owner}/${w.name}`,
		ref: { type: "pod" as const, namespace: w.pod.namespace, name: w.pod.name },
	})),
];

/** Nodes grouped by zone (topology.kubernetes.io/zone), zones in name order, those without one last. */
export const nodesByZone = (
	nodes: readonly ClusterNode[],
): [string | null, ClusterNode[]][] => {
	const zones = new Map<string | null, ClusterNode[]>();
	for (const n of nodes) {
		const z = n.zone ?? null;
		zones.set(z, [...(zones.get(z) ?? []), n]);
	}
	return [...zones.entries()].sort(([a], [b]) =>
		a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b),
	);
};

export type KindShare = {
	kind: ComponentKind | "rest";
	cpu: number;
	memory: number;
};

/**
 * What the pods on a node request, by kind, and the rest of its pods (those
 * that are not the platform's: the cluster's own, other teams') - the node's
 * stacked bars. The rest is the node's total requests less the platform's.
 */
export const requestsByKind = (
	node: ClusterNode,
	pods: readonly TopologyPod[],
): KindShare[] => {
	const mine = pods.filter((p) => p.node === node.name);
	const out: KindShare[] = [];
	for (const kind of KIND_ORDER) {
		const of = mine.filter((p) => p.kind === kind && p.requests);
		if (of.length) {
			out.push({
				kind,
				cpu: of.reduce((s, p) => s + (p.requests?.cpu ?? 0), 0),
				memory: of.reduce((s, p) => s + (p.requests?.memory ?? 0), 0),
			});
		}
	}
	const cpu = out.reduce((s, k) => s + k.cpu, 0);
	const memory = out.reduce((s, k) => s + k.memory, 0);
	const rest = {
		kind: "rest" as const,
		cpu: Math.max(0, node.requests.cpu - cpu),
		memory: Math.max(0, node.requests.memory - memory),
	};
	return rest.cpu > 0 || rest.memory > 0 ? [...out, rest] : out;
};

export type Spread = {
	kind: ComponentKind;
	pods: number;
	nodes: string[];
	zones: string[];
	/**
	 * spread: on more than one node; one-node: every replica on one node of a
	 * cluster that has more (a node's loss takes them all); single: one pod;
	 * cluster: the cluster has one node only.
	 */
	verdict: "spread" | "one-node" | "single" | "cluster";
};

/** How each kind's pods spread over the nodes and zones (workspaces and the rest left out: one pod each, or not ours). */
export const spreadByKind = (
	pods: readonly TopologyPod[],
	nodes: readonly ClusterNode[],
): Spread[] => {
	const zoneOf = new Map(nodes.map((n) => [n.name, n.zone]));
	const schedulable = nodes.filter((n) => n.ready && !n.unschedulable).length;
	return KIND_ORDER.filter((k) => k !== "workspace" && k !== "other")
		.map((kind) => {
			const of = pods.filter((p) => p.kind === kind);
			const onNodes = [
				...new Set(of.map((p) => p.node).filter((n): n is string => !!n)),
			].sort();
			const zones = [
				...new Set(
					onNodes.map((n) => zoneOf.get(n)).filter((z): z is string => !!z),
				),
			].sort();
			const verdict: Spread["verdict"] =
				of.length < 2
					? "single"
					: onNodes.length > 1
						? "spread"
						: schedulable > 1
							? "one-node"
							: "cluster";
			return { kind, pods: of.length, nodes: onNodes, zones, verdict };
		})
		.filter((s) => s.pods > 0);
};
