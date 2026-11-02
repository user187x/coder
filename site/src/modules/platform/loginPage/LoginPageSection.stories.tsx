import type { Meta, StoryObj } from "@storybook/react-vite";
import { LOGIN_PAGE_DEFAULT } from "#/api/platform";
import { backgroundsKey } from "#/api/queries/backgrounds";
import { loginPageKey } from "#/api/queries/platform";
import { MockBackgrounds } from "#/testHelpers/appearance";
import { LoginPageSection } from "./LoginPageSection";

const meta: Meta<typeof LoginPageSection> = {
	title: "modules/platform/LoginPageSection",
	component: LoginPageSection,
	parameters: {
		queries: [
			{ key: loginPageKey, data: LOGIN_PAGE_DEFAULT },
			{ key: backgroundsKey, data: MockBackgrounds },
		],
	},
};
export default meta;
type Story = StoryObj<typeof LoginPageSection>;
export const Compact: Story = {};

export const ImageHeading: Story = {
	parameters: {
		queries: [
			{ key: backgroundsKey, data: MockBackgrounds },
			{
				key: loginPageKey,
				data: {
					...LOGIN_PAGE_DEFAULT,
					headingMode: "image",
					headingImage: "/icon/coder.svg",
				},
			},
		],
	},
};

export const NoHeading: Story = {
	parameters: {
		queries: [
			{ key: backgroundsKey, data: MockBackgrounds },
			{
				key: loginPageKey,
				data: { ...LOGIN_PAGE_DEFAULT, headingMode: "none" },
			},
		],
	},
};
