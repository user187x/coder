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

export const ContinuousLongText: Story = {
	args: { placement: "navbar" },
	decorators: [
		(Story) => (
			<div className="flex w-[560px]">
				<Story />
			</div>
		),
	],
	parameters: {
		queries: [
			{
				key: bannerKey,
				data: {
					...MockBanner,
					loopText: true,
					effect: "none",
					message:
						"Scheduled maintenance: save your files and finish active jobs before the maintenance window. The administrators are available in chat if you need help. Your workspace will return after maintenance completes. Thank you for your patience.",
				},
			},
			{
				key: announcementStatusKey(MockBanner.id),
				data: { signedIn: true, username: "admin", acked: false },
			},
		],
	},
};
export const ReadLongTextOnce: Story = {
	...ContinuousLongText,
	parameters: {
		queries: [
			{
				key: bannerKey,
				data: {
					...MockBanner,
					loopText: false,
					effect: "none",
					message:
						"Scheduled maintenance: save your files and finish active jobs before the maintenance window. The administrators are available in chat if you need help. Your workspace will return after maintenance completes. Thank you for your patience.",
				},
			},
			{
				key: announcementStatusKey(MockBanner.id),
				data: { signedIn: true, username: "admin", acked: false },
			},
		],
	},
};
