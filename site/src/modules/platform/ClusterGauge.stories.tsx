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

// 15 minutes of traffic, one round every 15 seconds: a steady trickle with a burst.
const networkPoints = Array.from({ length: 60 }, (_, i) => ({
	t: 1_792_000_000 + i * 15,
	rx:
		180_000 +
		Math.round(120_000 * Math.sin(i / 4) ** 2) +
		(i > 44 ? 2_400_000 : 0),
	tx:
		90_000 + Math.round(60_000 * Math.cos(i / 5) ** 2) + (i > 48 ? 900_000 : 0),
}));

export const WithNetwork: Story = {
	parameters: {
		queries: [
			{
				key: clusterUsageKey,
				data: {
					...MockClusterUsage,
					network: {
						rx: networkPoints[59].rx,
						tx: networkPoints[59].tx,
						points: networkPoints,
						every: 15,
					},
				},
			},
		],
	},
};

// The same 15 minutes of CPU and memory: CPU busy for a few minutes (a workspace build), memory climbing slowly.
const historyPoints = Array.from({ length: 60 }, (_, i) => ({
	t: 1_792_000_000 + i * 15,
	cpu: 1.2 + 0.4 * Math.sin(i / 3) ** 2 + (i > 30 && i < 42 ? 9.5 : 0),
	cpuTotal: 16,
	memory: (18 + i * 0.12) * 1024 ** 3,
	memoryTotal: 64 * 1024 ** 3,
}));

export const WithHistory: Story = {
	parameters: {
		queries: [
			{
				key: clusterUsageKey,
				data: {
					...MockClusterUsage,
					history: { points: historyPoints, every: 15 },
					network: {
						rx: networkPoints[59].rx,
						tx: networkPoints[59].tx,
						points: networkPoints,
						every: 15,
					},
				},
			},
		],
	},
};
