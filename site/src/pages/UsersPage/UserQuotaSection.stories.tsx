import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { quotaReport } from "#/api/queries/platform";
import { MockUserMember, MockUserOwner } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { MockQuotaReport } from "#/testHelpers/userQuota";
import { UserQuotaProvider, UserQuotaSection } from "./UserQuotaSection";

const meta: Meta<typeof UserQuotaSection> = {
	title: "pages/UsersPage/UserQuotaSection",
	component: UserQuotaSection,
	parameters: { user: MockUserOwner },
	decorators: [
		withAuthProvider,
		(Story) => (
			<UserQuotaProvider enabled>
				<Story />
			</UserQuotaProvider>
		),
	],
};
export default meta;
type Story = StoryObj<typeof UserQuotaSection>;
export const Cumulative: Story = {
	parameters: {
		queries: [{ key: quotaReport().queryKey, data: MockQuotaReport }],
	},
};
export const PerInstanceCPU: Story = {
	parameters: {
		queries: [
			{
				key: quotaReport().queryKey,
				data: {
					...MockQuotaReport,
					settings: {
						...MockQuotaReport.settings,
						resourceModes: { cpu: "instance", memory: "cumulative" },
					},
				},
			},
		],
	},
};

export const ExcludedUsers: Story = {
	parameters: {
		queries: [
			{
				key: quotaReport().queryKey,
				data: {
					...MockQuotaReport,
					settings: {
						...MockQuotaReport.settings,
						excludedUsers: [MockUserMember.id],
					},
				},
			},
		],
	},
};
export const ExcludedUserPicker: Story = {
	...Cumulative,
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement).findByRole("combobox", {
				name: "Excluded users",
			}),
		);
	},
};
export const Mobile: Story = {
	...ExcludedUsers,
	parameters: {
		...ExcludedUsers.parameters,
		viewport: { defaultViewport: "mobile1" },
	},
};
