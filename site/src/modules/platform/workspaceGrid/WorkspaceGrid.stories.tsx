import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
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
