import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { RestoreChatButton } from "./ChatPanel";

const meta: Meta<typeof RestoreChatButton> = {
	title: "modules/platform/RestoreChatButton",
	component: RestoreChatButton,
	args: { total: 0, onRestore: fn() },
};
export default meta;
type Story = StoryObj<typeof RestoreChatButton>;
export const Compact: Story = {};
export const Unread: Story = { args: { total: 12 } };
