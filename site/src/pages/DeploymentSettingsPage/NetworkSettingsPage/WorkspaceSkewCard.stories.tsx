import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockClusterNetworkReport } from "#/testHelpers/clusterNetwork";
import { WorkspaceSkewCard } from "./WorkspaceSkewCard";

const template = MockClusterNetworkReport.workspaces[0];

const skewed = (counts: Record<string, number>) => ({
	...MockClusterNetworkReport,
	nodes: Object.keys(counts).map((name) => ({
		...MockClusterNetworkReport.nodes[0],
		name,
	})),
	workspaces: Object.entries(counts).flatMap(([node, n]) =>
		Array.from({ length: n }, (_, i) => ({
			...template,
			id: `${node}-${i}`,
			name: `ws-${i}`,
			pod: { ...template.pod, node, phase: "Running", ready: true },
		})),
	),
});

const meta: Meta<typeof WorkspaceSkewCard> = {
	title: "pages/DeploymentSettingsPage/NetworkSettingsPage/WorkspaceSkewCard",
	component: WorkspaceSkewCard,
};
export default meta;
type Story = StoryObj<typeof WorkspaceSkewCard>;

export const Skewed: Story = {
	args: {
		report: skewed({
			"k3d-coder-agent-0": 2,
			"k3d-coder-agent-1": 9,
			"k3d-coder-agent-2": 5,
			"k3d-coder-agent-3": 0,
			"k3d-coder-server-0": 7,
		}),
	},
};

export const Balanced: Story = {
	args: { report: skewed({ "node-a": 3, "node-b": 3, "node-c": 3 }) },
};
