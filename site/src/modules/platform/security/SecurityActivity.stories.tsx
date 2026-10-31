import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn } from "storybook/test";
import { API } from "#/api/api";
import { securityAuditLogs } from "#/api/queries/audits";
import { MockAuditLog, MockAuditLog2 } from "#/testHelpers/entities";
import { SecurityActivity } from "./SecurityActivity";

const meta: Meta<typeof SecurityActivity> = {
	title: "modules/platform/SecurityActivity",
	component: SecurityActivity,
	parameters: {
		queries: [
			{
				key: securityAuditLogs("", 0).queryKey,
				data: {
					audit_logs: [
						MockAuditLog,
						{
							...MockAuditLog2,
							action: "login",
							status_code: 401,
							user: null,
							additional_fields: {
								submitted_identifier: "unknown@example.test",
							},
						},
					],
					count: 2,
				},
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof SecurityActivity>;
export const Recorded: Story = {};
export const Empty: Story = {
	parameters: {
		queries: [
			{
				key: securityAuditLogs("", 0).queryKey,
				data: { audit_logs: [], count: 0 },
			},
		],
	},
};
export const Loading: Story = {
	parameters: { queries: [] },
	beforeEach: () => {
		spyOn(API, "getAuditLogs").mockReturnValue(new Promise(() => {}));
	},
};
export const Unavailable: Story = {
	parameters: { queries: [] },
	beforeEach: () => {
		spyOn(API, "getAuditLogs").mockRejectedValue(
			new Error("Security logs unavailable"),
		);
	},
};
