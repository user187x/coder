import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { cloudDrivePeers } from "#/api/queries/platform";
import {
	MockAccountCloudDrivePeers,
	MockAccountCloudDriveShare,
} from "#/testHelpers/cloudDriveShares";
import { AccountShareCables } from "./AccountShareCables";

const accounts = [
	{
		id: MockAccountCloudDriveShare.owner,
		username: MockAccountCloudDriveShare.ownerName,
	},
	{
		id: MockAccountCloudDriveShare.from,
		username: MockAccountCloudDriveShare.fromName,
	},
	{ id: "third-account", username: "eve" },
];
const meta: Meta<typeof AccountShareCables> = {
	title: "modules/platform/CloudDrive/AccountShareCables",
	component: AccountShareCables,
	args: {
		accounts,
		userIds: accounts.map((account) => account.id),
		children: (
			<section
				data-testid="accounts-card"
				className="rounded-lg border border-solid border-border p-4"
			>
				<table aria-label="Accounts" className="w-full">
					<tbody>
						{accounts.map((account) => (
							<tr key={account.id} data-testid={`user-${account.id}`}>
								<td className="h-20">{account.username}</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>
		),
	},
	decorators: [
		(Story) => (
			<div className="w-[640px] max-w-full">
				<Story />
			</div>
		),
	],
	parameters: {
		queries: [
			{ key: cloudDrivePeers().queryKey, data: MockAccountCloudDrivePeers },
		],
	},
};
export default meta;
type Story = StoryObj<typeof AccountShareCables>;
export const Connected: Story = {};
export const ReviewExistingGrant: Story = {
	play: async ({ canvasElement }) => {
		(
			await within(canvasElement).findByRole("button", {
				name: "Review Cloud Drive connections for ann",
			})
		).focus();
		await userEvent.keyboard("{Enter}");
	},
};
export const ReadOnly: Story = {
	parameters: {
		queries: [
			{
				key: cloudDrivePeers().queryKey,
				data: {
					...MockAccountCloudDrivePeers,
					admin: false,
					asked: [MockAccountCloudDriveShare],
				},
			},
		],
	},
};
export const Narrow: Story = {
	decorators: [
		(Story) => (
			<div className="w-[360px]">
				<Story />
			</div>
		),
	],
};
export const ReadAndWrite: Story = {
	parameters: {
		queries: [
			{
				key: cloudDrivePeers().queryKey,
				data: {
					...MockAccountCloudDrivePeers,
					all: [{ ...MockAccountCloudDriveShare, access: "write" }],
				},
			},
		],
	},
};
