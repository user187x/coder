import type { Meta, StoryObj } from "@storybook/react-vite";
import { onlineUsers } from "#/api/queries/platform";
import { MockUserMember } from "#/testHelpers/entities";
import { AccountPresence } from "./AccountPresence";

const meta: Meta<typeof AccountPresence> = {
	title: "pages/UsersPage/AccountPresence",
	component: AccountPresence,
	args: {
		user: { ...MockUserMember, last_seen_at: "2026-10-27T18:30:00Z" },
		enabled: true,
	},
};
export default meta;
type Story = StoryObj<typeof AccountPresence>;
export const Offline: Story = {
	parameters: {
		queries: [
			{
				key: onlineUsers().queryKey,
				data: {
					online: [],
					recent: [],
					idleSeconds: 300,
					generatedAt: "2026-10-27T19:00:00Z",
				},
			},
		],
	},
};
export const Unavailable: Story = { args: { enabled: false } };
export const Suspended: Story = {
	...Offline,
	args: { user: { ...MockUserMember, status: "suspended" } },
};
export const Online: Story = {
	parameters: {
		queries: [
			{
				key: onlineUsers().queryKey,
				data: {
					online: [
						{
							...MockUserMember,
							status: "active",
							tabs: 1,
							invisible: false,
							lastSeen: "2026-10-27T19:00:00Z",
							activeAt: "2026-10-27T19:00:00Z",
							since: "2026-10-27T18:30:00Z",
							workspaces: [],
						},
					],
					recent: [],
					idleSeconds: 300,
					generatedAt: "2026-10-27T19:00:00Z",
				},
			},
		],
	},
};
