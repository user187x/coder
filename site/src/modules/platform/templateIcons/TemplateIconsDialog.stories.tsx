import type { Meta, StoryObj } from "@storybook/react-vite";
import { templateIconsKey } from "#/api/queries/platform";
import { MockTemplateIcons } from "#/testHelpers/platform";
import { TemplateIconsDialog } from "./TemplateIconsDialog";

const meta: Meta<typeof TemplateIconsDialog> = {
	title: "modules/platform/TemplateIconsDialog",
	component: TemplateIconsDialog,
	args: { onClose: () => {} },
};

export default meta;
type Story = StoryObj<typeof TemplateIconsDialog>;

export const Manager: Story = {
	parameters: {
		queries: [{ key: templateIconsKey, data: MockTemplateIcons }],
	},
};

export const ReadOnly: Story = {
	parameters: {
		queries: [
			{
				key: templateIconsKey,
				data: { ...MockTemplateIcons, canManage: false },
			},
		],
	},
};

export const Empty: Story = {
	parameters: {
		queries: [{ key: templateIconsKey, data: { icons: [], canManage: true } }],
	},
};
