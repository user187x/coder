import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { ImagesAPI } from "#/api/images";
import { MockNodeImageCleanupPlan } from "#/testHelpers/nodeImageCleanup";
import { NodeImageCleanup } from "./NodeImageCleanup";

const meta: Meta<typeof NodeImageCleanup> = {
	title: "pages/Images/NodeImageCleanup",
	component: NodeImageCleanup,
	args: { images: MockNodeImageCleanupPlan.images },
	beforeEach: () => {
		const preview = spyOn(
			ImagesAPI,
			"previewNodeImageCleanup",
		).mockResolvedValue(MockNodeImageCleanupPlan);
		return () => preview.mockRestore();
	},
};
export default meta;
type Story = StoryObj<typeof NodeImageCleanup>;
export const Selection: Story = {};
export const NoSelection: Story = { args: { images: [] } };
export const Review: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement).findByRole("button", {
				name: "Purge selected",
			}),
		);
		await within(document.body).findByRole("dialog", {
			name: "Purge unused node images",
		});
	},
};
