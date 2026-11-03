import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { UpdateCheckNotice } from "./UpdateCheckNotice";

const meta: Meta<typeof UpdateCheckNotice> = {
	title: "modules/dashboard/UpdateCheckNotice",
	component: UpdateCheckNotice,
	args: {
		version: "v0.12.9",
		releaseNotesUrl: "https://github.com/coder/coder/releases/tag/v0.12.9",
		onDismiss: fn(),
	},
	parameters: {
		layout: "fullscreen",
	},
};

export default meta;
type Story = StoryObj<typeof UpdateCheckNotice>;

export const UpdateAvailable: Story = {};
