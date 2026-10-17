import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, within } from "storybook/test";
import { API } from "#/api/api";
import {
	GROUP_MEMBER_AVATAR_LIMIT,
	getGroupMemberAvatarsQueryKey,
} from "#/api/queries/groups";
import type { PaginatedGroup } from "#/api/typesGenerated";
import { getDefaultFilterProps } from "#/components/Filter/storyHelpers";
import type { UsersFilter } from "#/components/Filter/UsersFilter";
import {
	mockInitialRenderResult,
	mockSuccessResult,
} from "#/components/PaginationWidget/PaginationContainer.mocks";
import type { UsePaginatedQueryResult } from "#/hooks/usePaginatedQuery";
import {
	MockGroup,
	MockOrganization,
	MockUserMember,
	MockUserOwner,
} from "#/testHelpers/entities";
import { GroupsPageView } from "./GroupsPageView";

type FilterProps = React.ComponentProps<typeof UsersFilter>;

const meta: Meta<typeof GroupsPageView> = {
	title: "pages/OrganizationGroupsPage",
	component: GroupsPageView,
	args: {
		canCreateGroup: true,
		groupsEnabled: true,
		showOrganizations: true,
		filterProps: getDefaultFilterProps<FilterProps>({
			values: {},
			menus: {},
		}),
		groupsQuery: {
			...mockSuccessResult,
			totalRecords: 1,
		} as UsePaginatedQueryResult,
	},
};

export default meta;
type Story = StoryObj<typeof GroupsPageView>;

// The pagination story isn't about membership, so give its groups no members.
// Rows with a zero count skip the per-row avatar fetch.
const memberlessGroup = (id: string, name: string): PaginatedGroup => ({
	...MockGroup,
	id,
	name,
	display_name: name,
	total_member_count: 0,
});

// Seeds the per-row member avatar preview query for a group so the row renders
// avatars deterministically without hitting the network.
const seedAvatars = (
	groupName: string,
	users: ReadonlyArray<typeof MockUserOwner>,
	totalCount: number,
) => ({
	key: getGroupMemberAvatarsQueryKey(
		MockOrganization.name,
		groupName,
		GROUP_MEMBER_AVATAR_LIMIT,
	),
	data: { users, count: totalCount },
});

export const Default: Story = {};

export const NotEnabled: Story = {
	args: {
		groups: [MockGroup],
		groupsEnabled: false,
	},
};

export const WithGroups: Story = {
	args: {
		groups: [MockGroup],
	},
	parameters: {
		queries: [seedAvatars(MockGroup.name, [MockUserOwner, MockUserMember], 2)],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("heading", { name: "Groups" })).toBeVisible();
		await expect(
			canvas.getByRole("link", { name: /view docs/i }),
		).toBeVisible();
		expect(canvas.getAllByRole("link", { name: "New group" })).toHaveLength(1);
	},
};

// A group with more members than fit in the preview: the row shows the capped
// avatars plus a "+N" badge derived from total_member_count.
export const WithMemberAvatars: Story = {
	args: {
		groups: [
			{
				...MockGroup,
				id: "with-members",
				name: "with-members",
				display_name: "With members",
				total_member_count: 8,
			},
		],
	},
	parameters: {
		queries: [
			seedAvatars(
				"with-members",
				Array.from({ length: GROUP_MEMBER_AVATAR_LIMIT }, (_, i) => ({
					...MockUserOwner,
					id: `preview-${i}`,
					username: `member-${i}`,
				})),
				8,
			),
		],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("+3")).toBeInTheDocument();
		await expect(canvas.getByText("8 members")).toBeInTheDocument();
	},
};

export const WithMemberAvatarsLoading: Story = {
	args: {
		groups: [
			{
				...MockGroup,
				id: "members-loading",
				name: "members-loading",
				display_name: "Members loading",
				total_member_count: 3,
			},
		],
	},
	beforeEach: () => {
		spyOn(API, "getGroupMembers").mockImplementation(
			() => new Promise(() => {}),
		);
	},
};

const totalRecords = 15;
const totalPages = 3;
const limit = totalRecords / totalPages;

// Multiple pages of results with the search field in use.
export const WithSearchAndPagination: Story = {
	args: {
		groups: Array.from({ length: limit }, (_, i) =>
			memberlessGroup(`group-${i}`, `Group ${i}`),
		),
		filterProps: getDefaultFilterProps<FilterProps>({
			query: "group",
			values: {},
			menus: {},
			used: true,
		}),
		groupsQuery: {
			...mockSuccessResult,
			totalRecords,
			totalPages,
			limit,
			hasNextPage: true,
		} as UsePaginatedQueryResult,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByLabelText("Filter")).toHaveValue("group");
	},
};

// Groups still loading: the pagination + table render their loading states.
export const Loading: Story = {
	args: {
		groups: undefined,
		groupsQuery: mockInitialRenderResult as UsePaginatedQueryResult,
	},
};

export const WithDisplayGroup: Story = {
	args: {
		groups: [{ ...MockGroup, name: "front-end" }],
	},
	parameters: {
		queries: [seedAvatars("front-end", [MockUserOwner, MockUserMember], 2)],
	},
};

export const EmptyGroup: Story = {
	args: {
		groups: [],
		canCreateGroup: false,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("heading", { name: "Groups" })).toBeVisible();
		await expect(
			canvas.getByRole("link", { name: /view docs/i }),
		).toBeVisible();
		expect(
			canvas.queryByRole("link", { name: "New group" }),
		).not.toBeInTheDocument();
	},
};

export const EmptyGroupWithPermission: Story = {
	args: {
		groups: [],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("heading", { name: "Groups" })).toBeVisible();
		expect(
			canvas.getAllByRole("link", { name: "New group" }).length,
		).toBeGreaterThanOrEqual(2);
	},
};

// A search that matches nothing shows filter-aware copy, not the
// create-first-group empty state.
export const NoSearchResults: Story = {
	args: {
		groups: [],
		filterProps: getDefaultFilterProps<FilterProps>({
			query: "nomatch",
			values: {},
			menus: {},
			used: true,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText("No groups match your search"),
		).toBeInTheDocument();
		expect(canvas.queryByText("No groups yet")).not.toBeInTheDocument();
	},
};
