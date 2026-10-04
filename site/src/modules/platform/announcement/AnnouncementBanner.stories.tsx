import type { Meta, StoryObj } from "@storybook/react-vite";
import { announcementStatusKey, bannerKey } from "#/api/queries/platform";
import { MockBanner } from "#/testHelpers/platform";
import { AnnouncementBanner } from "./AnnouncementBanner";

const meta: Meta<typeof AnnouncementBanner> = {
	title: "modules/platform/AnnouncementBanner",
	component: AnnouncementBanner,
	args: { placement: "page" },
	parameters: {
		queries: [
			{ key: bannerKey, data: MockBanner },
			{
				key: announcementStatusKey(MockBanner.id),
				data: { signedIn: true, username: "admin", acked: false },
			},
		],
	},
};

export default meta;
type Story = StoryObj<typeof AnnouncementBanner>;

export const Page: Story = {};

export const Navbar: Story = {
	args: { placement: "navbar" },
	decorators: [
		(Story) => (
			<div className="flex w-[720px]">
				<Story />
			</div>
		),
	],
};

export const ConfirmedAndKept: Story = {
	parameters: {
		queries: [
			{ key: bannerKey, data: { ...MockBanner, dismissible: false } },
			{
				key: announcementStatusKey(MockBanner.id),
				data: { signedIn: true, username: "admin", acked: true },
			},
		],
	},
};

export const SignInPage: Story = {
	args: { placement: "login" },
};
