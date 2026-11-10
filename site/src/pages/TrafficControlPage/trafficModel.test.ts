import type { WorkspaceTunnel } from "#/api/platform";
import type { WorkspaceAgentPortShare } from "#/api/typesGenerated";
import {
	establishedPorts,
	type TrafficWorkspace,
	trafficTopologies,
	tunnelRate,
} from "./trafficModel";

const ws = (id: string, running = true): TrafficWorkspace => ({
	id,
	label: id,
	running,
	href: `/@me/${id}`,
	agentIds: [],
	organizationId: "org",
});

const tunnel = (
	id: string,
	source: string,
	target: string,
	over: Partial<WorkspaceTunnel> = {},
): WorkspaceTunnel => ({
	id,
	organization_id: "org",
	source_workspace_id: source,
	target_workspace_id: target,
	status: "ready",
	...over,
});

const share = (
	workspace: string,
	port: number,
	level: WorkspaceAgentPortShare["share_level"] = "authenticated",
): WorkspaceAgentPortShare => ({
	workspace_id: workspace,
	agent_name: "main",
	port,
	share_level: level,
	protocol: "http",
});

describe("trafficTopologies", () => {
	it("lays a chain out source first, with each tunnel's ports between its workspaces", () => {
		const [chain] = trafficTopologies(
			[ws("api"), ws("db"), ws("web")],
			[
				tunnel("t1", "web", "api", {
					ports: [{ protocol: "tcp", port: 8080 }],
				}),
				tunnel("t2", "api", "db", {
					ports: [
						{ protocol: "tcp", port: 5432 },
						{ protocol: "udp", port: 53 },
					],
				}),
			],
			new Map([["web", [share("web", 3000, "public")]]]),
		);
		expect(chain.title).toBe("web → api → db");
		expect(
			chain.columns.map((c) =>
				c.kind === "workspace"
					? c.workspaces.map((w) => w.id).join("+")
					: `${c.kind}[${c.orbs.map((o) => `${o.port}/${o.tag}`).join(" ")}]`,
			),
		).toEqual([
			"input[:3000/public]",
			"web",
			"output[:8080/tcp]",
			"api",
			"output[:5432/tcp :53/udp]",
			"db",
		]);
		expect(chain.links).toContainEqual({
			from: "api",
			to: "tunnel:t2:tcp:5432",
			tunnelId: "t2",
			ready: true,
		});
		expect(chain.links).toContainEqual({
			from: "tunnel:t2:tcp:5432",
			to: "db",
			tunnelId: "t2",
			ready: true,
		});
	});

	it("draws a tunnel open on every port as one orb, and one not ready as not ready", () => {
		const [chain] = trafficTopologies(
			[ws("a"), ws("b")],
			[tunnel("t", "a", "b", { ports: null, status: "pending" })],
			new Map(),
		);
		const ports = chain.columns.find((c) => c.kind === "output");
		expect(ports?.kind === "output" && ports.orbs).toEqual([
			expect.objectContaining({ port: "all", tag: "tcp+udp", ready: false }),
		]);
	});

	it("gathers the workspaces without a tunnel into one diagram, and leaves out tunnels to unseen workspaces", () => {
		const topologies = trafficTopologies(
			[ws("a"), ws("b", false)],
			[tunnel("t", "a", "someone-elses")],
			new Map([["a", [share("a", 8080)]]]),
		);
		expect(topologies).toHaveLength(1);
		expect(topologies[0].title).toBe("Standalone workspaces");
		expect(topologies[0].columns.map((c) => c.kind)).toEqual([
			"input",
			"workspace",
		]);
	});

	it("puts a later workspace's shared ports with the tunnel ports before it", () => {
		const [chain] = trafficTopologies(
			[ws("a"), ws("b")],
			[tunnel("t", "a", "b", { ports: [{ protocol: "tcp", port: 22 }] })],
			new Map([["b", [share("b", 8080)]]]),
		);
		expect(chain.columns.map((c) => c.kind)).toEqual([
			"workspace",
			"ports",
			"workspace",
		]);
	});

	it("keeps a loop of tunnels finite", () => {
		const [chain] = trafficTopologies(
			[ws("a"), ws("b")],
			[tunnel("t1", "a", "b"), tunnel("t2", "b", "a")],
			new Map(),
		);
		expect(chain.columns.filter((c) => c.kind === "workspace")).toHaveLength(2);
	});
});

describe("tunnelRate", () => {
	const stats = (rx: number, tx: number, stale = false) => ({
		updated_at: 0,
		stale,
		ports: [],
		series: [
			{ timestamp: 0, rx_bytes_per_second: rx, tx_bytes_per_second: tx },
		],
	});

	it("reads forward as what the source sends", () => {
		expect(
			tunnelRate(tunnel("t", "a", "b", { source_stats: stats(10, 900) })),
		).toEqual({ forward: 900, back: 10 });
	});

	it("falls back to the target's view, and has nothing when both are stale", () => {
		expect(
			tunnelRate(
				tunnel("t", "a", "b", {
					source_stats: stats(1, 1, true),
					target_stats: stats(700, 20),
				}),
			),
		).toEqual({ forward: 700, back: 20 });
		expect(
			tunnelRate(tunnel("t", "a", "b", { source_stats: stats(1, 1, true) })),
		).toEqual({ forward: null, back: null });
	});
});

describe("establishedPorts", () => {
	const side = (ports: [number, number][]) => ({
		updated_at: 0,
		stale: false,
		series: [],
		ports: ports.map(([local_port, remote_port]) => ({
			protocol: "tcp" as const,
			local_port,
			remote_port,
		})),
	});

	it("puts each connection's ports on their sides, whichever end reported it", () => {
		expect(
			establishedPorts(
				tunnel("t", "a", "b", {
					source_stats: side([[51000, 5432]]),
					target_stats: side([
						[5432, 51000],
						[8080, 52000],
					]),
				}),
			),
		).toEqual([
			{ protocol: "tcp", source: 51000, target: 5432 },
			{ protocol: "tcp", source: 52000, target: 8080 },
		]);
	});

	it("files the connections under the allowed port they reach", () => {
		const [chain] = trafficTopologies(
			[ws("a"), ws("b")],
			[
				tunnel("t", "a", "b", {
					ports: [
						{ protocol: "tcp", port: 5432 },
						{ protocol: "tcp", port: 22 },
					],
					source_stats: side([[51000, 5432]]),
				}),
			],
			new Map(),
		);
		const ports = chain.columns.find((c) => c.kind === "output");
		expect(
			ports?.kind === "output" &&
				ports.orbs.map((o) => [o.port, o.established]),
		).toEqual([
			[":5432", [{ protocol: "tcp", source: 51000, target: 5432 }]],
			[":22", []],
		]);
	});
});
