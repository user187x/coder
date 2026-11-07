import { screen, within } from "@testing-library/react";
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
			<WorkspaceSkewCard
				report={skewedReport({ "k3d-a": 0, "k3d-b": 2, "k3d-c": 7 })}
			/>,
		);
		const columns = screen.getAllByRole("listitem");
		expect(columns).toHaveLength(3);
		const tiles = (name: string) =>
			within(screen.getByRole("listitem", { name })).queryAllByRole("img");
		expect(tiles("k3d-a: 0 workspaces")).toHaveLength(0);
		expect(tiles("k3d-b: 2 workspaces")).toHaveLength(2);
		expect(tiles("k3d-c: 7 workspaces")).toHaveLength(7);
		expect(
			screen.getByText(
				/Most loaded: k3d-c \(7 workspaces\), least: k3d-a \(0\)/,
			),
		).toBeDefined();
	});

	it("labels a tile with the workspace name, owner and status", () => {
		renderComponent(
			<WorkspaceSkewCard report={skewedReport({ "k3d-a": 1 })} />,
		);
		expect(
			screen.getByRole("img", {
				name: `ws-k3d-a-0, owner ${template.owner}, Running`,
			}),
		).toBeDefined();
	});
});
