import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MockImageStoreImages } from "#/testHelpers/imageStore";
import { ImageStoreGrid } from "./ImageStoreGrid";

const meta: Meta<typeof ImageStoreGrid> = {
	title: "modules/platform/ImageStoreGrid",
	component: ImageStoreGrid,
	args: { images: MockImageStoreImages, layout: "grid", onChoose: fn() },
	decorators: [
		(Story) => (
			<div className="w-full max-w-[816px] p-4">
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof ImageStoreGrid>;

export const ManyImages: Story = {};
export const Narrow: Story = {
	decorators: [
		(Story) => (
			<div className="w-64">
				<Story />
			</div>
		),
	],
};
export const Selected: Story = {
	args: { selected: MockImageStoreImages[2].name },
};
export const Loading: Story = {
	args: { loading: MockImageStoreImages[2].name },
};
