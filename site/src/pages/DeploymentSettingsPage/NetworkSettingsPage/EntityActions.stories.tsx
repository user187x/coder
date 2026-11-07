import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, spyOn, userEvent, within } from "storybook/test";
import {
	ClusterNetworkAPI,
	type KubernetesEntityRef,
	networkLogTargets,
	networkPodLogs,
} from "#/api/clusterNetwork";
import {
	MockNetworkAnsiPodLogs,
	MockNetworkLogPod,
} from "#/testHelpers/clusterNetwork";
import { MockPermissions, MockUserOwner } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { EntityActionsProvider, EntityContextMenu } from "./EntityActions";

const target: KubernetesEntityRef = {
	type: "pod",
	namespace: MockNetworkLogPod.namespace,
	name: MockNetworkLogPod.name,
};
const meta: Meta<typeof EntityActionsProvider> = {
	title: "pages/DeploymentSettingsPage/NetworkSettingsPage/EntityActions",
	component: EntityActionsProvider,
	args: { onDetails: fn(), onOpen: fn() },
	beforeEach: () => {
		const targets = spyOn(ClusterNetworkAPI, "logTargets").mockResolvedValue({
			pods: [MockNetworkLogPod],
		});
		const logs = spyOn(ClusterNetworkAPI, "podLogs").mockResolvedValue(
			MockNetworkAnsiPodLogs,
		);
		return () => {
			targets.mockRestore();
			logs.mockRestore();
		};
	},
	render: (args) => (
		<EntityActionsProvider {...args}>
			<EntityContextMenu target={target}>
				<button type="button">Coder pod</button>
			</EntityContextMenu>
		</EntityActionsProvider>
	),
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserOwner,
		permissions: MockPermissions,
		queries: [
			{
				key: networkLogTargets(target).queryKey,
				data: { pods: [MockNetworkLogPod] },
			},
			{
				key: networkPodLogs(MockNetworkLogPod, "coder", false, false).queryKey,
				data: MockNetworkAnsiPodLogs,
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof EntityActionsProvider>;
const openMenu = async (canvasElement: HTMLElement) => {
	await userEvent.pointer({
		keys: "[MouseRight]",
		target: within(canvasElement).getByRole("button", { name: "Coder pod" }),
	});
};
export const Menu: Story = {
	play: async ({ canvasElement }) => openMenu(canvasElement),
};
export const Logs: Story = {
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		await userEvent.click(
			within(canvasElement.ownerDocument.body).getByRole("menuitem", {
				name: "View Logs",
			}),
		);
	},
};
export const Restart: Story = {
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		await userEvent.click(
			within(canvasElement.ownerDocument.body).getByRole("menuitem", {
				name: "Restart Pod",
			}),
		);
	},
};
