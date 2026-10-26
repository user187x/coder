import type { Meta, StoryObj } from "@storybook/react-vite";
import { quotaReport } from "#/api/queries/platform";
import { MockQuotaReport } from "#/testHelpers/userQuota";
import { UserQuotaProvider, UserQuotaSection } from "./UserQuotaSection";

const meta: Meta<typeof UserQuotaSection> = {
	title: "pages/UsersPage/UserQuotaSection",
	component: UserQuotaSection,
	decorators: [
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
