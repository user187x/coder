import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	MockResourceHistorySamples,
	MockResourceMetadata,
	MockWorkspaceResourceHistory,
} from "#/testHelpers/workspaceResources";
import { WorkspaceMetricHistory } from "./WorkspaceMetricDetails";

const meta: Meta<typeof WorkspaceMetricHistory> = {
	title: "modules/platform/WorkspaceMetricHistory",
	component: WorkspaceMetricHistory,
	decorators: [
		(Story) => (
			<div className="w-[360px] rounded-md border border-solid border-border bg-surface-primary p-4 text-xs text-content-secondary">
				<Story />
			</div>
		),
	],
	args: {
		label: "CPU",
		capacity: { text: "2", label: "Assigned maximum: 2 cores" },
		metric: MockResourceMetadata,
		history: MockWorkspaceResourceHistory,
		samples: MockResourceHistorySamples,
	},
};
export default meta;
type Story = StoryObj<typeof WorkspaceMetricHistory>;
export const CPU: Story = {};
export const MEM: Story = {
	args: {
		label: "MEM",
		capacity: { text: "8GiB", label: "Assigned maximum: 8 GiB" },
		metric: {
			...MockResourceMetadata,
			result: { ...MockResourceMetadata.result, value: "2.5 / 8 GiB (31%)" },
		},
	},
};
export const Disk: Story = {
	args: {
		label: "DISK",
		capacity: { text: "10GiB", label: "Assigned maximum: 10 GiB" },
		metric: {
			...MockResourceMetadata,
			result: { ...MockResourceMetadata.result, value: "3.2 / 10 GiB (32%)" },
		},
	},
};
export const MissingReadings: Story = {
	args: { samples: [], metric: undefined, capacity: null },
};
export const Loading: Story = { args: { history: undefined, loading: true } };
export const Unavailable: Story = {
	args: {
		history: undefined,
		error: "History is unavailable. It will retry automatically.",
	},
};
export const RefetchFailed: Story = { args: { error: "Connection failed" } };
export const MeasurementError: Story = {
	args: {
		metric: {
			...MockResourceMetadata,
			result: {
				...MockResourceMetadata.result,
				error: "Agent could not measure CPU usage.",
			},
		},
	},
};
