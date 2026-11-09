import type { Meta, StoryObj } from "@storybook/react-vite";
import { safeKey } from "#/api/queries/platform";
import { MockQuotaReport } from "#/testHelpers/userQuota";
import { CloudDrive } from "../cloudDrive/CloudDrive";
import { QuotaRequestButton } from "../quotaRequests/QuotaRequestButton";
import { WorkspaceQuotaPillView } from "./WorkspaceQuotaPill";

const usage = { workspaces: 1, cpu: 2, memory: 4, disk: 0 };
const meta = {
	title: "modules/platform/WorkspaceQuotaPill",
	component: WorkspaceQuotaPillView,
	args: {
		quota: {
			limited: true,
			exempt: false,
			limits: { workspaces: 4, cpu: 6, memory: 10, disk: 0 },
			baseLimits: MockQuotaReport.settings.default,
			bonus: { workspaces: 1, cpu: 2, memory: 2, disk: 0 },
			activeGrantCount: 1,
			usage,
		},
	},
} satisfies Meta<typeof WorkspaceQuotaPillView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AvailableCapacity: Story = {
	args: {
		action: <QuotaRequestButton />,
		quota: {
			...meta.args.quota,
			limits: { workspaces: 2, cpu: 8, memory: 12, disk: 25 },
			bonus: { workspaces: 0, cpu: 0, memory: 0, disk: 0 },
			activeGrantCount: 0,
			usage: { workspaces: 0, cpu: 0, memory: 0, disk: 0 },
			resourceModes: {
				cpu: "cumulative",
				memory: "cumulative",
				disk: "instance",
			},
		},
	},
};

export const Narrow: Story = {
	...AvailableCapacity,
	decorators: [
		(Story) => (
			<div className="w-80 max-w-full">
				<Story />
			</div>
		),
	],
};

export const ApprovedExtras: Story = {};
export const AtLimit: Story = {
	args: {
		quota: {
			...meta.args.quota,
			usage: { workspaces: 4, cpu: 6, memory: 10, disk: 0 },
			atLimit: true,
		},
	},
};
export const UnlimitedWithGrant: Story = {
	args: {
		quota: {
			...meta.args.quota,
			limited: false,
			limits: { workspaces: null, cpu: null, memory: null, disk: null },
		},
	},
};

/** The account's Cloud Drive as the table's last column. */
export const WithCloudDrive: Story = {
	...AvailableCapacity,
	args: {
		...AvailableCapacity.args,
		cloudDrive: <CloudDrive placement="quota" workspaceIds={[]} />,
	},
	parameters: {
		queries: [
			{
				key: safeKey,
				data: {
					enabled: true,
					mountPath: "/home/coder/cloud-drive",
					usedBytes: 1536 * 1024 * 1024,
					files: 3,
					quotaBytes: 10 * 1024 ** 3,
					maxUploadBytes: 5 * 1024 ** 3,
					volume: "ready",
				},
			},
			{
				key: [...safeKey, "settings"],
				data: {
					status: { connected: true, error: null, checkedAt: 0, latencyMs: 12 },
				},
			},
			{
				key: [...safeKey, "connections"],
				data: { disconnected: [], shared: [], workspaceConnections: [] },
			},
		],
	},
};

/** User Quota switched off: the Cloud Drive alone, at the same size, on the left. */
export const CloudDriveWithoutQuota: Story = {
	...WithCloudDrive,
	args: {
		...WithCloudDrive.args,
		quota: { ...meta.args.quota, limited: false, usage: undefined },
	},
};
