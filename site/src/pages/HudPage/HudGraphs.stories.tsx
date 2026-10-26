import type { Meta, StoryObj } from "@storybook/react-vite";
import { hudHistory } from "#/api/queries/platform";
import { MockHudHistory } from "#/testHelpers/hud";
import { HudGraphs } from "./HudGraphs";

const meta: Meta<typeof HudGraphs> = {
	title: "pages/HUD/Graphs",
	component: HudGraphs,
	parameters: {
		queries: [{ key: hudHistory("1h").queryKey, data: MockHudHistory }],
	},
};
export default meta;
type Story = StoryObj<typeof HudGraphs>;
export const Storage: Story = {};
export const Empty: Story = {
	parameters: {
		queries: [
			{
				key: hudHistory("1h").queryKey,
				data: { ...MockHudHistory, points: [] },
			},
		],
	},
};
export const MissingStorage: Story = {
	parameters: {
		queries: [
			{
				key: hudHistory("1h").queryKey,
				data: {
					...MockHudHistory,
					points: MockHudHistory.points.map((p) => ({
						...p,
						diskUsed: null,
						diskClaimed: null,
						diskTotal: null,
						volumeUsed: null,
					})),
				},
			},
		],
	},
};
