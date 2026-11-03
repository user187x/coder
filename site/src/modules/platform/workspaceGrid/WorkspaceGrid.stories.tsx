import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, userEvent, within } from "storybook/test";
import { workspaces } from "#/api/queries/workspaces";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import { MockWorkspace } from "#/testHelpers/entities";
import { WorkspaceGrid } from "./WorkspaceGrid";

const peer = { ...MockWorkspace, id: "grid-peer", name: "peer" };
const meta: Meta<typeof WorkspaceGrid> = {
	title: "modules/platform/WorkspaceGrid",
	component: WorkspaceGrid,
	args: {
		ids: [MockWorkspace.id, peer.id],
		open: true,
		onOpenChange: () => {},
	},
	parameters: {
		queries: [
			{
				key: workspaces({ q: "owner:me" }).queryKey,
				data: { workspaces: [MockWorkspace, peer], count: 2 },
			},
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: { tunnels: [] },
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof WorkspaceGrid>;
export const Grid: Story = {};
export const Focused: Story = {
	play: async () => {
		await userEvent.click(
			await within(document.body).findByRole("button", { name: "Focus peer" }),
		);
	},
};

export const List: Story = { args: { initialLayout: "list" } };

export const TwoRowsInView: Story = {
	...List,
	play: async () => {
		const slider = await within(document.body).findByRole("slider", {
			name: "Workspaces in view",
		});
		fireEvent.input(slider, { target: { value: "2" } });
	},
};

export const SwitchToList: Story = {
	play: async () => {
		const body = within(document.body);
		await userEvent.click(
			await body.findByRole("button", { name: "Workspace layout: Grid" }),
		);
		await userEvent.click(body.getByRole("menuitemradio", { name: "List" }));
	},
};
