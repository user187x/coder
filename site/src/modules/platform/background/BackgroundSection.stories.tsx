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
export const SignIn: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("tab", { name: "Sign-in / sign-out" }),
		);
	},
};
