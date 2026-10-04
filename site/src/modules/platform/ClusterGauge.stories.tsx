import type { Meta, StoryObj } from "@storybook/react-vite";
import { clusterUsageKey } from "#/api/queries/platform";
import { MockClusterUsage } from "#/testHelpers/platform";
import { ClusterGauge } from "./ClusterGauge";

const meta: Meta<typeof ClusterGauge> = {
	title: "modules/platform/ClusterGauge",
	component: ClusterGauge,
	decorators: [
		(Story) => (
			<div className="w-[300px]">
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof ClusterGauge>;

export const Live: Story = {
	parameters: {
		queries: [{ key: clusterUsageKey, data: MockClusterUsage }],
	},
};

export const NearlyFull: Story = {
	parameters: {
		queries: [
			{
				key: clusterUsageKey,
				data: {
					...MockClusterUsage,
					live: false,
					cpu: { total: 16, used: 15.2, requested: 15.2, free: 0.8 },
				},
			},
		],
	},
};
