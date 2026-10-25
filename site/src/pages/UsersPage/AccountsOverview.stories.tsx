import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import {
	insightsUserActivity,
	insightsUserLatency,
} from "#/api/queries/insights";
import { notesByUserKey, quotaReport } from "#/api/queries/platform";
import { workspacePowerHistory } from "#/api/queries/workspacePower";
import { workspaces } from "#/api/queries/workspaces";
import { lastDays } from "#/modules/platform/userInsights/userInsights";
import {
	MockUserMember,
	MockUserOwner,
	MockWorkspace,
} from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { MockQuotaReport } from "#/testHelpers/userQuota";
import { QuotaEditorContext, UserQuotaProvider } from "./UserQuotaSection";
import { UsersTable } from "./UsersTable";

const alpha = {
	...MockWorkspace,
	id: "alpha",
	name: "alpha",
	owner_name: MockUserMember.username,
	owner_id: MockUserMember.id,
};
const beta = { ...alpha, id: "beta", name: "beta" };
const params = lastDays();
const meta: Meta<typeof UsersTable> = {
	title: "pages/UsersPage/AccountsOverview",
	component: UsersTable,
	args: {
		users: [MockUserMember],
		isLoading: false,
		groupsByUserId: undefined,
		me: MockUserOwner.id,
		canEditUsers: true,
		canManageWorkspaces: true,
		onAction: fn(),
	},
	decorators: [
		(Story) => (
			<UserQuotaProvider enabled>
				<Story />
			</UserQuotaProvider>
		),
		withAuthProvider,
	],
	parameters: {
		queries: [
			{ key: quotaReport().queryKey, data: MockQuotaReport },
			{ key: notesByUserKey, data: { users: {} } },
			{
				key: workspaces({ q: `owner:${MockUserMember.username}`, limit: 0 })
					.queryKey,
				data: { workspaces: [alpha, beta], count: 2 },
			},
			{
				key: workspacePowerHistory(MockWorkspace.organization_id).queryKey,
				data: { operations: [] },
			},
			{
				key: insightsUserLatency(params).queryKey,
				data: {
					report: {
						users: [
							{ user_id: MockUserMember.id, latency_ms: { p50: 42, p95: 80 } },
						],
					},
				},
			},
			{
				key: insightsUserActivity(params).queryKey,
				data: {
					report: { users: [{ user_id: MockUserMember.id, seconds: 3600 }] },
				},
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof UsersTable>;
export const MergedQuota: Story = {};
export const ExpandedWorkspaces: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: `Expand workspaces for ${MockUserMember.username}`,
			}),
		);
	},
};
export const SelectedWorkspaces: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", {
				name: `Expand workspaces for ${MockUserMember.username}`,
			}),
		);
		await userEvent.click(
			await canvas.findByRole("checkbox", {
				name: `Choose all workspaces for ${MockUserMember.username}`,
			}),
		);
	},
};
export const EmptyWorkspaces: Story = {
	parameters: {
		queries: [
			{ key: quotaReport().queryKey, data: MockQuotaReport },
			{ key: notesByUserKey, data: { users: {} } },
			{
				key: workspaces({ q: `owner:${MockUserMember.username}`, limit: 0 })
					.queryKey,
				data: { workspaces: [], count: 0 },
			},
			{
				key: workspacePowerHistory(MockWorkspace.organization_id).queryKey,
				data: { operations: [] },
			},
			{
				key: insightsUserLatency(params).queryKey,
				data: {
					report: {
						users: [
							{ user_id: MockUserMember.id, latency_ms: { p50: 42, p95: 80 } },
						],
					},
				},
			},
			{
				key: insightsUserActivity(params).queryKey,
				data: {
					report: { users: [{ user_id: MockUserMember.id, seconds: 3600 }] },
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: `Expand workspaces for ${MockUserMember.username}`,
			}),
		);
	},
};

export const AccountsLoading: Story = { args: { isLoading: true } };
export const QuotaLoading: Story = {
	decorators: [
		(Story) => (
			<QuotaEditorContext.Provider
				value={{
					error: null,
					dirty: false,
					saving: false,
					setDraft: fn(),
					onSave: fn(),
					onDiscard: fn(),
				}}
			>
				<Story />
			</QuotaEditorContext.Provider>
		),
	],
};
export const QuotaUnavailable: Story = {
	decorators: [
		(Story) => (
			<QuotaEditorContext.Provider
				value={{
					error: new Error("Resource quota could not be loaded"),
					dirty: false,
					saving: false,
					setDraft: fn(),
					onSave: fn(),
					onDiscard: fn(),
				}}
			>
				<Story />
			</QuotaEditorContext.Provider>
		),
	],
};
export const UnsavedQuota: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: new RegExp(`Resources for ${MockUserMember.username}:`),
			}),
		);
		await userEvent.type(
			within(canvasElement.ownerDocument.body).getByRole("textbox", {
				name: `CPU cores for ${MockUserMember.username}`,
			}),
			"5",
		);
	},
};

export const ResourceDetails: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: new RegExp(`Resources for ${MockUserMember.username}:`),
			}),
		);
	},
};

export const MixedAccountIdentity: Story = {
	args: {
		users: [
			MockUserOwner,
			MockUserMember,
			{
				...MockUserMember,
				id: "long-account",
				username: "developer-with-a-long-name",
				email: "developer-with-a-long-name@engineering.example.com",
			},
		],
	},
};

export const NarrowAccounts: Story = {
	args: MixedAccountIdentity.args,
	decorators: [
		(Story) => (
			<div className="w-[360px] max-w-full">
				<Story />
			</div>
		),
	],
};
