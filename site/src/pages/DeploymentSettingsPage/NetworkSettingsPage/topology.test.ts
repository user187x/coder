import type { ClusterNode } from "#/api/platform";
import { MockClusterNetworkReport } from "#/testHelpers/clusterNetwork";
import {
	nodesByZone,
	requestsByKind,
	spreadByKind,
	topologyPods,
} from "./topology";

const pods = topologyPods(MockClusterNetworkReport);
const [nodeA, nodeB] = MockClusterNetworkReport.nodes;

describe("topologyPods", () => {
	it("places the platform's pods and the workspaces with their kinds", () => {
		expect(pods.map((p) => [p.name, p.kind, p.node])).toEqual([
			["coder-5d9f7c", "coder", "node-a"],
			["coder-db-1", "database", "node-b"],
			["coder-code-server-replicator-7f-a", "replicator", "node-a"],
			["traefik-6d-x", "gateway", "node-a"],
			["coder-ws-dev", "workspace", "node-b"],
		]);
		expect(pods[4].label).toBe(
			`${MockClusterNetworkReport.workspaces[0].owner}/dev`,
		);
		expect(pods[3].ref).toEqual({
			type: "pod",
			namespace: "traefik",
			name: "traefik-6d-x",
		});
	});
});

describe("requestsByKind", () => {
	it("splits a node's requests by kind, the rest of its pods last", () => {
		const node: ClusterNode = {
			...nodeA,
			requests: { cpu: 2, memory: 4 * 1024 ** 3 },
		};
		const shares = requestsByKind(node, pods);
		expect(shares.map((s) => s.kind)).toEqual(["coder", "replicator", "rest"]);
		expect(shares[0].cpu).toBe(0.5);
		expect(shares[2].cpu).toBeCloseTo(2 - 0.5 - 0.01);
	});

	it("has no rest when the platform's pods are all a node runs", () => {
		const node: ClusterNode = {
			...nodeB,
			requests: { cpu: 2.25, memory: 4.5 * 1024 ** 3 },
		};
		expect(requestsByKind(node, pods).map((s) => s.kind)).toEqual([
			"database",
			"workspace",
		]);
	});
});

describe("spreadByKind", () => {
	const two = [
		{ ...pods[0], name: "coder-a", node: "node-a" },
		{ ...pods[0], name: "coder-b", node: "node-a" },
		{ ...pods[1], name: "db-1", node: "node-a" },
		{ ...pods[1], name: "db-2", node: "node-b" },
		pods[2],
	];

	it("says which kinds have every replica on one node", () => {
		const s = Object.fromEntries(
			spreadByKind(two, MockClusterNetworkReport.nodes).map((x) => [
				x.kind,
				x.verdict,
			]),
		);
		expect(s).toEqual({
			coder: "one-node",
			database: "spread",
			replicator: "single",
		});
	});

	it("does not blame placement on a cluster of one node", () => {
		const s = spreadByKind(two, [nodeA]);
		expect(s.find((x) => x.kind === "coder")?.verdict).toBe("cluster");
	});
});

describe("nodesByZone", () => {
	it("groups by zone, those without one last", () => {
		const z = (name: string, zone: string | null): ClusterNode => ({
			...nodeA,
			name,
			zone,
		});
		expect(
			nodesByZone([
				z("n1", null),
				z("n2", "b"),
				z("n3", "a"),
				z("n4", "b"),
			]).map(([zone, ns]) => [zone, ns.map((n) => n.name)]),
		).toEqual([
			["a", ["n3"]],
			["b", ["n2", "n4"]],
			[null, ["n1"]],
		]);
	});
});
