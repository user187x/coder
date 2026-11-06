import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { BrowserSessionShutterView } from "./BrowserSessionShutter";

const meta: Meta<typeof BrowserSessionShutterView> = {
	title: "modules/platform/agentPanels/BrowserSessionShutter",
	component: BrowserSessionShutterView,
	args: {
		status: { configured: true, locked: false, retryAfter: 0 },
		busy: false,
		error: null,
		setup: false,
		onCancelSetup: fn(),
		onSetAndLock: fn(),
		onUnlock: fn(),
		children: (
			<div className="flex flex-1 items-center justify-center bg-surface-tertiary">
				Browser session
			</div>
		),
	},
	decorators: [
		(Story) => (
			<div className="flex h-[420px] w-[640px]">
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof BrowserSessionShutterView>;

export const Unlocked: Story = {};
export const Locked: Story = {
	args: { status: { configured: true, locked: true, retryAfter: 0 } },
};
export const RateLimited: Story = {
	args: { status: { configured: true, locked: true, retryAfter: 120 } },
};
export const SettingPIN: Story = {
	args: {
		status: { configured: false, locked: false, retryAfter: 0 },
		setup: true,
	},
};
