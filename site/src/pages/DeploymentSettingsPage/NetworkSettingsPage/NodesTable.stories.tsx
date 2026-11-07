import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { ClusterNetworkAPI, networkNodePods } from "#/api/clusterNetwork";
import {
	MockClusterNetworkReport,
	MockNodePod,
} from "#/testHelpers/clusterNetwork";
import { MockPermissions, MockUserOwner } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { EntityProvider } from "./EntityDetails";
import { NodesTable } from "./NodesTable";

const meta: Meta<typeof NodesTable> = {
	title: "pages/DeploymentSettingsPage/NetworkSettingsPage/NodesTable",
	component: NodesTable,
	args: { report: MockClusterNetworkReport },
	decorators: [
		withAuthProvider,
		(Story) => (
			<EntityProvider>
				<Story />
			</EntityProvider>
		),
	],
	beforeEach: () => {
		const pods = spyOn(ClusterNetworkAPI, "nodePods").mockResolvedValue({
			node: null,
			pods: [MockNodePod],
		});
		return () => pods.mockRestore();
	},
	parameters: {
		user: MockUserOwner,
		permissions: MockPermissions,
		queries: [
			{
				key: networkNodePods().queryKey,
				data: { node: null, pods: [MockNodePod] },
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof NodesTable>;
export const Default: Story = {};
export const Expanded: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Pods on node-a" }),
		);
	},
};
export const Live: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Live view" }),
		);
	},
};
export const FullTable: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Table view" }),
		);
	},
};
export const Empty: Story = {
	args: { report: { ...MockClusterNetworkReport, nodes: [] } },
};
export const Unavailable: Story = {
	beforeEach: () => {
		const pods = spyOn(ClusterNetworkAPI, "nodePods").mockRejectedValue(
			new Error("Kubernetes node inventory is unavailable."),
		);
		return () => pods.mockRestore();
	},
	play: Live.play,
};
