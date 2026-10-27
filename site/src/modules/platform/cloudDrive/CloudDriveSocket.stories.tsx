import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockUserOwner, MockWorkspace } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { CloudDriveSocket } from "./CloudDriveSocket";

const meta = {
	title: "modules/platform/CloudDrive/CloudDriveSocket",
	component: CloudDriveSocket,
	decorators: [withAuthProvider],
	parameters: { user: MockUserOwner },
	args: {
		workspace: { ...MockWorkspace, owner_name: "bob" },
		mine: false,
		links: {
			enabled: true,
			ready: true,
			workspaceConnections: [],
			off: new Set<string>(),
			shared: new Set<string>(),
			older: new Set<string>(),
			attaching: new Set<string>(),
		},
	},
} satisfies Meta<typeof CloudDriveSocket>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AvailableForSharing: Story = {};
export const ConnectedForSharing: Story = {
	args: {
		links: {
			...meta.args.links,
			workspaceConnections: [
				{
					workspaceId: MockWorkspace.id,
					workspaceName: MockWorkspace.name,
					recipientId: MockWorkspace.owner_id,
					recipientName: "bob",
					organizationId: MockWorkspace.organization_id,
				},
			],
		},
	},
};
export const ReadingConnections: Story = {
	args: { links: { ...meta.args.links, ready: false } },
};
