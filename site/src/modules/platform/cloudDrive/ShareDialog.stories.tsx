import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "react-query";
import { fn, spyOn, userEvent, within } from "storybook/test";
import { PlatformAPI } from "#/api/platform";
import {
	cloudDriveConnections,
	cloudDrivePeers,
	cloudDrivePeople,
} from "#/api/queries/platform";
import { MockAccountCloudDrivePeers } from "#/testHelpers/cloudDriveShares";
import { ShareDialog } from "./ShareDialog";

const meta = {
	title: "modules/platform/CloudDrive/ShareDialog",
	component: ShareDialog,
	args: { path: "docs/plans", kind: "folder", onClose: fn() },
	decorators: [
		(Story) => {
			const client = new QueryClient({
				defaultOptions: {
					queries: { enabled: false, staleTime: Number.POSITIVE_INFINITY },
				},
			});
			client.setQueryData(
				cloudDrivePeers().queryKey,
				MockAccountCloudDrivePeers,
			);
			client.setQueryData(cloudDrivePeople(true).queryKey, { people: [] });
			client.setQueryData(cloudDriveConnections().queryKey, {
				disconnected: [],
				older: [],
				workspaceConnections: [
					{
						workspaceId: "workspace-id",
						workspaceName: "development",
						recipientId: "bob-id",
						recipientName: "bob",
						organizationId: "org",
					},
				],
			});
			spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
				MockAccountCloudDrivePeers,
			);
			spyOn(PlatformAPI, "getCloudDrivePeople").mockResolvedValue({
				people: [],
			});
			spyOn(PlatformAPI, "getCloudDriveConnections").mockResolvedValue({
				disconnected: [],
				older: [],
				workspaceConnections: [
					{
						workspaceId: "workspace-id",
						workspaceName: "development",
						recipientId: "bob-id",
						recipientName: "bob",
						organizationId: "org",
					},
				],
			});
			return (
				<QueryClientProvider client={client}>
					<Story />
				</QueryClientProvider>
			);
		},
	],
} satisfies Meta<typeof ShareDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SelectedFolder: Story = {};

export const ChooseRecipients: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement.ownerDocument.body).getByRole("button", {
				name: "With",
			}),
		);
	},
};
