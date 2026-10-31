import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockLavaAvatar } from "#/testHelpers/avatar";
import { MockUserOwner } from "#/testHelpers/entities";
import { AccountAvatar } from "./AccountAvatar";

const meta: Meta<typeof AccountAvatar> = {
	title: "modules/platform/AccountAvatar",
	component: AccountAvatar,
	args: { user: { ...MockUserOwner, avatar_url: MockLavaAvatar } },
};
export default meta;
type Story = StoryObj<typeof AccountAvatar>;
export const Animated: Story = {};
export const Initials: Story = {
	args: { user: { ...MockUserOwner, avatar_url: "" } },
};
