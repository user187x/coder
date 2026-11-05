import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { classificationKey } from "#/api/queries/platform";
import { MockClassification } from "#/testHelpers/platform";
import { withToaster } from "#/testHelpers/storybook";
import ClassificationSettingsPage from "./ClassificationSettingsPage";

const meta: Meta<typeof ClassificationSettingsPage> = {
	title: "pages/DeploymentSettingsPage/ClassificationSettingsPage",
	component: ClassificationSettingsPage,
	decorators: [withToaster],
};

export default meta;
type Story = StoryObj<typeof ClassificationSettingsPage>;

export const Enabled: Story = {
	parameters: {
		queries: [{ key: classificationKey, data: MockClassification }],
	},
};

export const Disabled: Story = {
	parameters: {
		queries: [
			{
				key: classificationKey,
				data: { ...MockClassification, enabled: false },
			},
		],
	},
};

export const DashboardOnly: Story = {
	parameters: {
		queries: [
			{
				key: classificationKey,
				data: { ...MockClassification, showOnLogin: false },
			},
		],
	},
};

export const LowContrast: Story = {
	parameters: {
		queries: [
			{
				key: classificationKey,
				data: {
					...MockClassification,
					text: "TOP SECRET//SCI",
					background: "#fce83a",
					color: "#ffffff",
				},
			},
		],
	},
};

export const TextColour: Story = {
	...Enabled,
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement).findByRole("tab", {
				name: "Text",
			}),
		);
	},
};
export const Mobile: Story = {
	...Enabled,
	parameters: {
		...Enabled.parameters,
		viewport: { defaultViewport: "mobile1" },
	},
};
