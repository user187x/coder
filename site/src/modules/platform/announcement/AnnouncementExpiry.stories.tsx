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
export const CenteredPicture: Story = {
	args: {
		banner: {
			...meta.args.banner,
			countdown: "",
			picture: "/icon/coder.svg",
			message: "Scheduled maintenance",
		},
	},
};
export const WrappedMessage: Story = {
	args: {
		banner: {
			...meta.args.banner,
			countdown: "",
			message:
				"Maintenance begins this evening. Please save your work and close any open terminals before the scheduled restart. You can reopen your workspace after the maintenance window.",
		},
	},
};
export const ImmediateForceFocus: Story = {
	args: { banner: { ...meta.args.banner, countdown: "" } },
};
export const ShakeScreen: Story = {
	args: { banner: { ...meta.args.banner, countdownAction: "shake" } },
};
