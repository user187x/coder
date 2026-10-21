import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	clusterEntityKey,
	clusterHAKey,
	clusterMeshKey,
} from "#/api/clusterNetwork";
import { networkReportKey } from "#/api/queries/platform";
import {
	MockClusterNetworkReport,
	MockHAStorageReport,
	MockLinkDetails,
	MockMeshReport,
	MockNodeDetails,
	MockPodDetails,
} from "#/testHelpers/clusterNetwork";
import { ClusterMap } from "./ClusterMap";

// The cards, and what a click on the Coder pod, node-a or the platform service -> Coder connection opens.
const cards = [
	{ key: clusterMeshKey, data: MockMeshReport },
	{ key: clusterHAKey, data: MockHAStorageReport },
	{
		key: clusterEntityKey({
			type: "pod",
			namespace: "coder",
			name: "coder-5d9f7c",
		}),
		data: MockPodDetails,
	},
	{
		key: clusterEntityKey({ type: "node", name: "node-a" }),
		data: MockNodeDetails,
	},
	{
		key: clusterEntityKey({ type: "link", id: "platform-coder" }),
		data: MockLinkDetails,
	},
];

const meta: Meta<typeof ClusterMap> = {
	title: "pages/DeploymentSettingsPage/NetworkSettingsPage/ClusterMap",
	component: ClusterMap,
	parameters: {
		queries: [
			{ key: networkReportKey, data: MockClusterNetworkReport },
			...cards,
		],
	},
};

export default meta;
type Story = StoryObj<typeof ClusterMap>;

export const Default: Story = {};

export const NodeNotReady: Story = {
	parameters: {
		queries: [
			{
				key: networkReportKey,
				data: {
					...MockClusterNetworkReport,
					nodes: MockClusterNetworkReport.nodes.map((n, i) =>
						i === 1 ? { ...n, ready: false } : n,
					),
					metrics: false,
				},
			},
			...cards,
		],
	},
};

export const WithoutCodeServerHA: Story = {
	parameters: {
		queries: [
			{ key: networkReportKey, data: MockClusterNetworkReport },
			{
				key: clusterMeshKey,
				data: {
					...MockMeshReport,
					nodes: MockMeshReport.nodes.filter(
						(n) => n.id !== "code-server" && n.id !== "replicator",
					),
					edges: MockMeshReport.edges.filter(
						(e) =>
							![e.from, e.to].some(
								(id) => id === "code-server" || id === "replicator",
							),
					),
				},
			},
			{
				key: clusterHAKey,
				data: {
					...MockHAStorageReport,
					codeServerHA: {
						...MockHAStorageReport.codeServerHA,
						installed: false,
						replicators: [],
						instances: [],
						schema: false,
					},
				},
			},
		],
	},
};
