import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, within } from "storybook/test";
import { PlatformAPI } from "#/api/platform";
import { quotaReport, schedulerReport } from "#/api/queries/platform";
import {
	getDefaultFilterProps,
	MockMenu,
} from "#/components/Filter/storyHelpers";
import { mockSuccessResult } from "#/components/PaginationWidget/PaginationContainer.mocks";
import {
	MockUserMember,
	MockUserOwner,
	mockApiError,
} from "#/testHelpers/entities";
import { MockQuotaReport, MockSchedulerReport } from "#/testHelpers/userQuota";
import { UserQuotaProvider, UserQuotaSection } from "./UserQuotaSection";
import { UsersPageView } from "./UsersPageView";

type FilterProps = React.ComponentProps<typeof UsersPageView>["filterProps"];

const defaultFilterProps = getDefaultFilterProps<FilterProps>({
	query: "owner:me",
	menus: {
		status: MockMenu,
	},
	values: {
		status: "active",
	},
});

const meta: Meta<typeof UsersPageView> = {
	title: "pages/UsersPageView",
	component: UsersPageView,
	args: {
		canEditUsers: true,
		me: MockUserOwner.id,
		filterProps: defaultFilterProps,
		usersQuery: {
			...mockSuccessResult,
			totalRecords: 2,
			data: {
				count: 2,
				users: [MockUserOwner, MockUserMember],
			},
		},
	},
};

export default meta;
type Story = StoryObj<typeof UsersPageView>;

export const Admin: Story = {
	args: {
		canCreateUser: true,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("link", { name: "New account" }),
		).toBeVisible();
	},
};

export const SmallViewport: Story = {
	parameters: {
		pixel: { matrix: { viewports: ["tablet"] } },
	},
};

export const Member: Story = {
	args: { canEditUsers: false },
};

export const Empty: Story = {
	args: {
		usersQuery: {
			...mockSuccessResult,
			totalRecords: 0,
			data: {
				count: 0,
				users: [],
			},
		},
	},
};

export const EmptyPage: Story = {
	args: {
		usersQuery: {
			...mockSuccessResult,
			totalRecords: 0,
			data: {
				count: 0,
				users: [],
			},
		},
	},
};

export const WithError: Story = {
	args: {
		usersQuery: {
			...mockSuccessResult,
			totalRecords: 0,
			data: {
				count: 0,
				users: [],
			},
		},
		filterProps: {
			...defaultFilterProps,
			error: mockApiError({
				message: "Invalid user search query.",
				validations: [
					{
						field: "status",
						detail: `Query param "status" has invalid value: "inactive" is not a valid user status`,
					},
				],
			}),
		},
	},
};

export const QuotaAndSchedulerCards: Story = {
	beforeEach: () => {
		spyOn(PlatformAPI, "getQuotaReport").mockResolvedValue(MockQuotaReport);
		spyOn(PlatformAPI, "getSchedulerReport").mockResolvedValue(
			MockSchedulerReport,
		);
	},
	args: { quota: <UserQuotaSection quotaAdjustments={<span />} /> },
	decorators: [
		(Story) => (
			<UserQuotaProvider enabled>
				<Story />
			</UserQuotaProvider>
		),
	],
	parameters: {
		queries: [
			{ key: quotaReport().queryKey, data: MockQuotaReport },
			{ key: schedulerReport().queryKey, data: MockSchedulerReport },
		],
	},
};
