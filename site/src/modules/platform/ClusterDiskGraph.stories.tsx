import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockHudHistory } from "#/testHelpers/hud";
import { ClusterDiskGraph } from "./ClusterDiskGraph";

const history = {
	...MockHudHistory,
	start: MockHudHistory.end - 900,
	points: MockHudHistory.points.slice(-30),
};
const meta: Meta<typeof ClusterDiskGraph> = {
	title: "modules/platform/ClusterDiskGraph",
	component: ClusterDiskGraph,
	decorators: [
		(Story) => (
			<div className="w-[264px]">
				<Story />
			</div>
		),
	],
	args: { history },
};
export default meta;
type Story = StoryObj<typeof ClusterDiskGraph>;
export const Measured: Story = {};
export const ClaimsAboveCapacity: Story = {
	args: {
		history: {
			...history,
			points: history.points.map((point) => ({ ...point, diskClaimed: 140 })),
		},
	},
};
export const MissingDiskMetrics: Story = {
	args: {
		history: {
			...history,
			points: history.points.map((point) => ({
				...point,
				diskUsed: null,
				diskTotal: null,
				diskClaimed: null,
			})),
		},
	},
};
export const Empty: Story = { args: { history: { ...history, points: [] } } };
export const Loading: Story = { args: { history: undefined, loading: true } };
export const Unavailable: Story = {
	args: {
		history: undefined,
		error: "Disk history is unavailable. It will retry automatically.",
	},
};
export const RefetchFailed: Story = { args: { error: "Connection failed" } };
