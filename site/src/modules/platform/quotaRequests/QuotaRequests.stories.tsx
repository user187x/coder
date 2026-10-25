import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MockOrganization } from "#/testHelpers/entities";
import { MockQuotaRequest } from "#/testHelpers/quotaRequests";
import { QuotaRequestsView } from "./QuotaAdjustments";

const meta: Meta<typeof QuotaRequestsView> = {
	title: "modules/platform/QuotaRequests",
	component: QuotaRequestsView,
	args: {
		requests: [MockQuotaRequest],
		organizations: [MockOrganization],
		onDecide: fn(),
	},
	decorators: [
		(Story) => (
			<div className="max-w-2xl p-4">
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof QuotaRequestsView>;
export const Pending: Story = {};
export const Empty: Story = { args: { requests: [] } };
export const Saving: Story = { args: { busy: true } };
export const History: Story = {
	args: {
		requests: [
			{
				...MockQuotaRequest,
				status: "approved",
				reviewed_at: 1792803600,
				review_reason: "Approved for the integration project.",
			},
			{
				...MockQuotaRequest,
				id: "denied-request",
				status: "denied",
				reviewed_at: 1792803600,
				review_reason: "Use the existing test workspace first.",
			},
			{
				...MockQuotaRequest,
				id: "revoked-request",
				status: "revoked",
				reviewed_at: 1792803600,
			},
		],
	},
};
