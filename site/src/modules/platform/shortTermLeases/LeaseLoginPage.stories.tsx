import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { ShortTermLeasesAPI } from "#/api/shortTermLeases";
import { LeaseLoginPage } from "./LeaseLoginPage";

const meta: Meta<typeof LeaseLoginPage> = {
	title: "modules/platform/LeaseLoginPage",
	component: LeaseLoginPage,
};
export default meta;
type Story = StoryObj<typeof LeaseLoginPage>;
export const Default: Story = {};
export const InvalidToken: Story = {
	beforeEach: () => {
		const request = spyOn(ShortTermLeasesAPI, "login").mockRejectedValue(
			new Error("This lease has expired or was revoked."),
		);
		return () => request.mockRestore();
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByLabelText("Session token"),
			"example-expired-token",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Open Browser workspace" }),
		);
	},
};
