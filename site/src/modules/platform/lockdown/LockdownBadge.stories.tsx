import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockWorkspace } from "#/testHelpers/entities";
import { LockdownBadge } from "./Lockdown";

const meta: Meta<typeof LockdownBadge> = {
	title: "modules/platform/LockdownBadge",
	component: LockdownBadge,
	args: { workspace: MockWorkspace, modes: [], goldIcon: true },
};
export default meta;
type Story = StoryObj<typeof LockdownBadge>;
export const Unlocked: Story = {};
export const Locked: Story = { args: { modes: ["network", "sudo"] } };
export const Frozen: Story = { args: { modes: ["freeze"] } };
