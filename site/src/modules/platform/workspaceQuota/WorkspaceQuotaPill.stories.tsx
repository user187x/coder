import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockQuotaReport } from "#/testHelpers/userQuota";
import { WorkspaceQuotaPillView } from "./WorkspaceQuotaPill";

const usage = { workspaces: 1, cpu: 2, memory: 4 };
const meta = {
	title: "modules/platform/WorkspaceQuotaPill",
	component: WorkspaceQuotaPillView,
	args: {
		quota: {
			limited: true,
			exempt: false,
			limits: { workspaces: 4, cpu: 6, memory: 10 },
			baseLimits: MockQuotaReport.settings.default,
			bonus: { workspaces: 1, cpu: 2, memory: 2 },
			activeGrantCount: 1,
			usage,
		},
	},
} satisfies Meta<typeof WorkspaceQuotaPillView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ApprovedExtras: Story = {};
export const AtLimit: Story = {
	args: {
		quota: {
			...meta.args.quota,
			usage: { workspaces: 4, cpu: 6, memory: 10 },
			atLimit: true,
		},
	},
};
export const UnlimitedWithGrant: Story = {
	args: {
		quota: {
			...meta.args.quota,
			limited: false,
			limits: { workspaces: null, cpu: null, memory: null },
		},
	},
};
