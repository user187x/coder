import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockChatSettings } from "#/testHelpers/chat";
import { ScreenSharingCard } from "./ChatSettingsPage";

const meta: Meta<typeof ScreenSharingCard> = {
	title: "pages/DeploymentSettingsPage/ChatSettingsPage/ScreenSharingCard",
	component: ScreenSharingCard,
	args: { settings: MockChatSettings },
};
export default meta;
type Story = StoryObj<typeof ScreenSharingCard>;
export const AdminsOnly: Story = {};
export const UsersAllowed: Story = {
	args: { settings: { ...MockChatSettings, screenSharing: true } },
};
