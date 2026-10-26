import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockHudStorage } from "#/testHelpers/hud";
import { HudStorageClasses } from "./HudStorageClasses";

const meta: Meta<typeof HudStorageClasses> = {
	title: "pages/HUD/StorageClasses",
	component: HudStorageClasses,
	args: { storage: MockHudStorage },
};
export default meta;
type Story = StoryObj<typeof HudStorageClasses>;
export const Storage: Story = {};
export const Empty: Story = {
	args: { storage: { ...MockHudStorage, classes: [] } },
};
export const Unavailable: Story = {
	args: {
		storage: { ...MockHudStorage, inventoryAvailable: false, classes: [] },
	},
};
