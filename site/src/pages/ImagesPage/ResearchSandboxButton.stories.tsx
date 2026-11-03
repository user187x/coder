import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { MockResearchSandbox } from "#/testHelpers/researchSandbox";
import { ResearchSandboxButton } from "./ResearchSandboxButton";

const meta: Meta<typeof ResearchSandboxButton> = {
	title: "pages/Images/ResearchSandboxButton",
	component: ResearchSandboxButton,
	args: { sandbox: MockResearchSandbox },
};
export default meta;
type Story = StoryObj<typeof ResearchSandboxButton>;

export const Available: Story = {};
export const WorkspaceSetup: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Deploy research sandbox",
			}),
		);
	},
};
export const NotConfigured: Story = {
	args: { sandbox: null },
	play: WorkspaceSetup.play,
};
