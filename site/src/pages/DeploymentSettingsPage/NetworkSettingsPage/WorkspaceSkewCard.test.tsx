import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { ClusterNetworkReport } from "#/api/clusterNetwork";
import { MockClusterNetworkReport } from "#/testHelpers/clusterNetwork";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { WorkspaceSkewCard } from "./WorkspaceSkewCard";

const template = MockClusterNetworkReport.workspaces[0];

const skewedReport = (
	counts: Record<string, number>,
): ClusterNetworkReport => ({
	...MockClusterNetworkReport,
	nodes: Object.keys(counts).map((name) => ({
		...MockClusterNetworkReport.nodes[0],
		name,
	})),
	workspaces: Object.entries(counts).flatMap(([node, n]) =>
		Array.from({ length: n }, (_, i) => ({
			...template,
			id: `${node}-${i}`,
			name: `ws-${node}-${i}`,
			pod: { ...template.pod, node, phase: "Running", ready: true },
		})),
	),
});

describe("WorkspaceSkewCard", () => {
	it("renders a column per node with one filled tile per workspace", () => {
		renderComponent(
			<MemoryRouter>
				<WorkspaceSkewCard
					report={skewedReport({ "k3d-a": 0, "k3d-b": 2, "k3d-c": 7 })}
				/>
			</MemoryRouter>,
		);
		const columns = screen.getAllByRole("listitem");
		expect(columns).toHaveLength(3);
		const tiles = (name: string) =>
			within(screen.getByRole("listitem", { name })).queryAllByRole("link");
		expect(tiles("k3d-a: 0 workspaces")).toHaveLength(0);
		expect(tiles("k3d-b: 2 workspaces")).toHaveLength(2);
		expect(tiles("k3d-c: 7 workspaces")).toHaveLength(7);
		expect(
			screen.getByText(
				/Most loaded: k3d-c \(7 workspaces\), least: k3d-a \(0\)/,
			),
		).toBeDefined();
	});

	it("shows node capacity, measurements and workspace latency in its footer", () => {
		const report = skewedReport({ "k3d-a": 1 });
		report.nodes[0] = {
			...report.nodes[0],
			addresses: { InternalIP: ["172.19.0.6"] },
			arch: "amd64",
			capacity: { cpu: 24, memory: 64 * 1024 ** 3, pods: 110, storage: null },
			usage: { cpu: 1, memory: 4 * 1024 ** 3 },
			loadAverage: 2.5,
		};
		report.workspaces[0].agents = [20, 40].map((latencyMs) => ({
			name: "main",
			status: "connected",
			lifecycle: "ready",
			version: "1",
			os: "linux",
			arch: "amd64",
			latencyMs,
		}));
		renderComponent(
			<MemoryRouter>
				<WorkspaceSkewCard report={report} />
			</MemoryRouter>,
		);
		const card = within(
			screen.getByRole("listitem", { name: "k3d-a: 1 workspace" }),
		);
		for (const value of [
			"172.19.0.6",
			"amd64",
			"24 cores",
			"64.0 GiB",
			"4.0 GiB",
			"30.0 ms",
			"2.50",
		]) {
			expect(card.getByText(value)).toBeTruthy();
		}
	});

	it("links to the workspace and shows its owner, status and online time on hover", async () => {
		const user = userEvent.setup();
		const report = skewedReport({ "k3d-a": 1 });
		report.workspaces[0].pod.started = new Date(
			Date.now() - 120_000,
		).toISOString();
		renderComponent(
			<MemoryRouter>
				<WorkspaceSkewCard report={report} />
			</MemoryRouter>,
		);
		const tile = screen.getByRole("link", {
			name: `ws-k3d-a-0, owner ${template.owner}, Running`,
		});
		expect(tile).toHaveAttribute("href", `/@${template.owner}/ws-k3d-a-0`);
		await user.hover(tile);
		const tooltip = await screen.findByRole("tooltip");
		expect(tooltip).toHaveTextContent(`Owner: ${template.owner}`);
		expect(tooltip).toHaveTextContent("Status: Running");
		expect(tooltip).toHaveTextContent("Online time: 2 min");
	});
});
