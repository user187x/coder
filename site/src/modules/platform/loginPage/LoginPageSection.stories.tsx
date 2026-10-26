import type { Meta, StoryObj } from "@storybook/react-vite";
import { LOGIN_PAGE_DEFAULT } from "#/api/platform";
import { loginPageKey } from "#/api/queries/platform";
import { LoginPageSection } from "./LoginPageSection";

const meta: Meta<typeof LoginPageSection> = {
	title: "modules/platform/LoginPageSection",
	component: LoginPageSection,
	parameters: { queries: [{ key: loginPageKey, data: LOGIN_PAGE_DEFAULT }] },
};
export default meta;
type Story = StoryObj<typeof LoginPageSection>;
export const Compact: Story = {};
