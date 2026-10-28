import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockBanner } from "#/testHelpers/platform";
import { AnnouncementExpiryNotice } from "./AnnouncementExpiry";

const meta = {
	title: "modules/announcement/AnnouncementExpiry",
	component: AnnouncementExpiryNotice,
	args: {
		userId: "expiry-story",
		banner: {
			...MockBanner,
			id: "expiry-story",
			enabled: true,
			message: "Scheduled maintenance is starting. Please save your work.",
			countdown: "2020-01-01T00:00:00Z",
			countdownAction: "focus",
		},
	},
} satisfies Meta<typeof AnnouncementExpiryNotice>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ForceFocus: Story = {};
export const ShakeScreen: Story = {
	args: { banner: { ...meta.args.banner, countdownAction: "shake" } },
};
