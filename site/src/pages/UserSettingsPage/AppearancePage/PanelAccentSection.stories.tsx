import type { Meta, StoryObj } from "@storybook/react-vite";
import { panelAccentGlobal, userUIPreferences } from "#/api/queries/platform";
import { MockUserOwner } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { PanelAccentSection } from "./PanelAccentSection";

const meta: Meta<typeof PanelAccentSection> = {
	title: "pages/UserSettingsPage/AppearancePage/PanelAccentSection",
	component: PanelAccentSection,
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserOwner,
		permissions: { editDeploymentConfig: true },
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: { panel_accent: { mode: "custom", color: "#22c55e" } },
			},
			{ key: panelAccentGlobal().queryKey, data: { global: null } },
		],
	},
};

export default meta;
type Story = StoryObj<typeof PanelAccentSection>;

export const CustomAccent: Story = {};

export const LargerPanels: Story = {
	parameters: {
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: { panel_accent: { mode: "theme" }, panel_scale: 120 },
			},
			{ key: panelAccentGlobal().queryKey, data: { global: null } },
		],
	},
};
