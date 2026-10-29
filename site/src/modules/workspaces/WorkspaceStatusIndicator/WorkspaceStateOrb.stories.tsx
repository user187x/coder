import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceStateOrb } from "./WorkspaceStateOrb";

const meta = {
	title: "modules/workspaces/WorkspaceStateOrb",
	component: WorkspaceStateOrb,
	args: { state: "running" },
} satisfies Meta<typeof WorkspaceStateOrb>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Running: Story = {};
export const Failed: Story = { args: { state: "error" } };
export const Starting: Story = { args: { state: "starting" } };
export const Locked: Story = { args: { state: "locked" } };
export const Stopped: Story = { args: { state: "stopped" } };
