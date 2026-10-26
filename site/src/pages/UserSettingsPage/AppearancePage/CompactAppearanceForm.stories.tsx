import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MockCustomTheme } from "#/testHelpers/appearance";
import { MockUserAppearanceSettings } from "#/testHelpers/entities";
import { encodeCustomTheme } from "#/theme/customTheme";
import { CompactAppearanceForm } from "./CompactAppearanceForm";

const meta: Meta<typeof CompactAppearanceForm> = {
	title: "pages/UserSettingsPage/CompactAppearanceForm",
	component: CompactAppearanceForm,
	args: {
		initialValues: MockUserAppearanceSettings,
		activeScheme: "dark",
		onSubmit: fn(),
	},
};
export default meta;
type Story = StoryObj<typeof CompactAppearanceForm>;
export const Preset: Story = {};
export const CustomColors: Story = {
	args: {
		initialValues: {
			...MockUserAppearanceSettings,
			theme_preference: encodeCustomTheme(MockCustomTheme),
		},
	},
};
export const SystemThemes: Story = {
	args: {
		initialValues: { ...MockUserAppearanceSettings, theme_mode: "sync" },
	},
};
