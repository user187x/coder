import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import {
	cloudDriveSettings,
	hudHistory,
	quotaMeResources,
	quotaReport,
	safe,
	workspaceNetwork,
	workspaceResourceHistory,
} from "#/api/queries/platform";
import { MockUserMember, MockUserOwner } from "#/testHelpers/entities";
import { MockHudHistory } from "#/testHelpers/hud";
import {
	MockCloudDriveSettings,
	MockSafeSummary,
} from "#/testHelpers/platform";
import { withAuthProvider } from "#/testHelpers/storybook";
import {
	MockDashboardNetwork,
	MockDashboardResourceHistory,
	MockQuotaMeResources,
	MockQuotaReport,
} from "#/testHelpers/userQuota";
import DashboardPage from "./DashboardPage";

const [dev, data] = MockQuotaMeResources.workspaces;

const meta: Meta<typeof DashboardPage> = {
	title: "pages/DashboardPage",
	component: DashboardPage,
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserMember,
		permissions: {},
		queries: [
			{ key: quotaMeResources(false).queryKey, data: MockQuotaMeResources },
			{
				key: workspaceResourceHistory(dev.id).queryKey,
				data: MockDashboardResourceHistory,
			},
			{ key: workspaceNetwork(dev.id).queryKey, data: MockDashboardNetwork },
			{ key: safe().queryKey, data: MockSafeSummary },
			{ key: cloudDriveSettings().queryKey, data: MockCloudDriveSettings },
		],
	},
};

export default meta;
type Story = StoryObj<typeof DashboardPage>;

export const Default: Story = {};

export const NearQuota: Story = {
	parameters: {
		queries: [
			{
				key: quotaMeResources(false).queryKey,
				data: {
					...MockQuotaMeResources,
					usage: { workspaces: 2, cpu: 7, memory: 16, disk: 30 },
				},
			},
			{
				key: workspaceResourceHistory(dev.id).queryKey,
				data: MockDashboardResourceHistory,
			},
			{ key: workspaceNetwork(dev.id).queryKey, data: MockDashboardNetwork },
			{ key: safe().queryKey, data: MockSafeSummary },
			{ key: cloudDriveSettings().queryKey, data: MockCloudDriveSettings },
		],
	},
};

export const WithGpu: Story = {
	parameters: {
		queries: [
			{
				key: quotaMeResources(false).queryKey,
				data: {
					...MockQuotaMeResources,
					workspaces: [{ ...dev, gpus: 1 }, data],
				},
			},
			{
				key: workspaceResourceHistory(dev.id).queryKey,
				data: MockDashboardResourceHistory,
			},
			{ key: workspaceNetwork(dev.id).queryKey, data: MockDashboardNetwork },
			{ key: safe().queryKey, data: MockSafeSummary },
			{ key: cloudDriveSettings().queryKey, data: MockCloudDriveSettings },
		],
	},
};

export const NoWorkspaces: Story = {
	parameters: {
		queries: [
			{
				key: quotaMeResources(false).queryKey,
				data: {
					...MockQuotaMeResources,
					usage: { workspaces: 0, cpu: 0, memory: 0, disk: 0 },
					workspaces: [],
				},
			},
			{ key: safe().queryKey, data: { ...MockSafeSummary, usedBytes: 0 } },
			{ key: cloudDriveSettings().queryKey, data: MockCloudDriveSettings },
		],
	},
};

export const AdminWholeCluster: Story = {
	parameters: {
		user: MockUserOwner,
		permissions: { viewDeploymentConfig: true },
		queries: [
			{
				key: quotaMeResources(false).queryKey,
				data: { ...MockQuotaMeResources, exempt: true },
			},
			{
				key: quotaReport().queryKey,
				data: {
					...MockQuotaReport,
					users: MockQuotaReport.users.map((user) => ({
						...user,
						workspaces: MockQuotaMeResources.workspaces.map((w) => ({
							...w,
							owner: user.username,
							ownerId: user.id,
						})),
					})),
				},
			},
			{ key: hudHistory("15m").queryKey, data: MockHudHistory },
			{
				key: workspaceResourceHistory(dev.id).queryKey,
				data: MockDashboardResourceHistory,
			},
			{ key: workspaceNetwork(dev.id).queryKey, data: MockDashboardNetwork },
			{ key: safe().queryKey, data: MockSafeSummary },
			{ key: cloudDriveSettings().queryKey, data: MockCloudDriveSettings },
		],
	},
	// Switches to the cluster view so the screenshot captures it.
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Whole cluster" }),
		);
	},
};
