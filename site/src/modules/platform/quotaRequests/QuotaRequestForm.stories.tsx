import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MockOrganization } from "#/testHelpers/entities";
import { QuotaRequestForm } from "./QuotaRequestButton";

const meta: Meta<typeof QuotaRequestForm> = {
	title: "modules/platform/QuotaRequestForm",
	component: QuotaRequestForm,
	args: {
		organizations: [MockOrganization],
		requestId: "story-request",
		onSubmit: fn(),
	},
	decorators: [
		(Story) => (
			<div className="max-w-lg p-4">
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof QuotaRequestForm>;
export const Ready: Story = {};
export const Submitting: Story = { args: { busy: true } };
export const NoOrganizations: Story = { args: { organizations: [] } };
