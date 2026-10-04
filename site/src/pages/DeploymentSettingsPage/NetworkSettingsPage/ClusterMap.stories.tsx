import type { Meta, StoryObj } from "@storybook/react-vite";
import { networkReportKey } from "#/api/queries/platform";
import { MockNetworkReport } from "#/testHelpers/platform";
import { ClusterMap } from "./ClusterMap";

const meta: Meta<typeof ClusterMap> = {
	title: "pages/DeploymentSettingsPage/NetworkSettingsPage/ClusterMap",
	component: ClusterMap,
	parameters: {
		queries: [{ key: networkReportKey, data: MockNetworkReport }],
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
					...MockNetworkReport,
					nodes: MockNetworkReport.nodes.map((n, i) =>
						i === 1 ? { ...n, ready: false } : n,
					),
					metrics: false,
				},
			},
		],
	},
};
