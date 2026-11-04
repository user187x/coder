import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, spyOn, userEvent, within } from "storybook/test";
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
		focused: false,
		onFocusChange: () => {},
		onPageSizeChange: () => {},
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
		onCreateLease: fn(),
	},
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const trigger = canvas.getByRole("button", { name: "New account" });
		await userEvent.click(trigger);
		const menu = within(await within(document.body).findByRole("menu"));
		await expect(
			menu.getByRole("menuitem", { name: "New account" }),
		).toHaveAttribute("href", expect.stringMatching(/create$/));
		await userEvent.click(menu.getByRole("menuitem", { name: "Create Lease" }));
		await expect(args.onCreateLease).toHaveBeenCalledOnce();
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
