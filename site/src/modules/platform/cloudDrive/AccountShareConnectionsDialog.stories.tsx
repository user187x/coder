import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MockAccountCloudDriveShare } from "#/testHelpers/cloudDriveShares";
import { AccountShareConnectionsDialog } from "./AccountShareConnectionsDialog";

const meta: Meta<typeof AccountShareConnectionsDialog> = {
	title: "modules/platform/CloudDrive/AccountShareConnectionsDialog",
	component: AccountShareConnectionsDialog,
	args: {
		open: true,
		onOpenChange: fn(),
		sharingEnabled: true,
		shares: [MockAccountCloudDriveShare],
	},
};
export default meta;
type Story = StoryObj<typeof AccountShareConnectionsDialog>;
export const Connected: Story = {};
export const Disconnected: Story = {
	args: {
		shares: [
			{ ...MockAccountCloudDriveShare, state: "ended", reconnectable: true },
		],
	},
};
export const SharingDisabled: Story = {
	args: { ...Disconnected.args, sharingEnabled: false },
};
export const Empty: Story = { args: { shares: [] } };

export const ReviewUnsharedPair: Story = {
	args: {
		ownerId: MockAccountCloudDriveShare.owner,
		recipientId: "unshared-account",
	},
};
