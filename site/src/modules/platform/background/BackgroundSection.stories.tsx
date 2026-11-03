import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { backgroundsKey } from "#/api/queries/backgrounds";
import { MockBackgrounds } from "#/testHelpers/appearance";
import { BackgroundSection } from "./BackgroundSection";

const meta: Meta<typeof BackgroundSection> = {
	title: "modules/platform/BackgroundSection",
	component: BackgroundSection,
	parameters: { queries: [{ key: backgroundsKey, data: MockBackgrounds }] },
};
export default meta;
type Story = StoryObj<typeof BackgroundSection>;
export const Dashboard: Story = {};
export const Gradient: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("combobox", { name: "Source" }));
		await userEvent.click(
			within(document.body).getByRole("option", { name: "Color or gradient" }),
		);
		await userEvent.click(canvas.getByRole("combobox", { name: "Fill style" }));
		await userEvent.click(
			within(document.body).getByRole("option", { name: "Linear gradient" }),
		);
	},
};
