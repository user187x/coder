import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn } from "storybook/test";
import {
	ClusterNetworkAPI,
	networkNodeConfiguration,
} from "#/api/clusterNetwork";
import { MockNodeConfiguration } from "#/testHelpers/clusterNetwork";
import { NodeActions } from "./NodeActions";

const meta: Meta<typeof NodeActions> = {
	title: "pages/DeploymentSettingsPage/NetworkSettingsPage/NodeActions",
	component: NodeActions,
	args: { name: MockNodeConfiguration.name, action: "edit-node" },
	decorators: [
		(Story) => (
			<div className="max-w-xl rounded-lg bg-surface-primary p-5">
				<Story />
			</div>
		),
	],
	beforeEach: () => {
		const query = spyOn(
			ClusterNetworkAPI,
			"nodeConfiguration",
		).mockResolvedValue(MockNodeConfiguration);
		return () => query.mockRestore();
	},
	parameters: {
		queries: [
			{
				key: networkNodeConfiguration(MockNodeConfiguration.name).queryKey,
				data: MockNodeConfiguration,
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof NodeActions>;
export const Edit: Story = {};
export const Cordon: Story = { args: { action: "cordon-node" } };
export const Taints: Story = {
	args: { action: "taint-node" },
	parameters: {
		queries: [
			{
				key: networkNodeConfiguration(MockNodeConfiguration.name).queryKey,
				data: {
					...MockNodeConfiguration,
					taints: [
						{ key: "dedicated", value: "workspace", effect: "NoSchedule" },
					],
				},
			},
		],
	},
};
export const Unavailable: Story = {
	parameters: {
		queries: [
			{
				key: networkNodeConfiguration(MockNodeConfiguration.name).queryKey,
				data: undefined,
				isError: true,
			},
		],
	},
	beforeEach: () => {
		const query = spyOn(
			ClusterNetworkAPI,
			"nodeConfiguration",
		).mockRejectedValue(new Error("Node settings could not be loaded."));
		return () => query.mockRestore();
	},
};
