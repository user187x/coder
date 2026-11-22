import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
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

export const EditMenu: Story = {
	...Navbar,
	args: { ...Navbar.args, onEdit: fn() },
	play: async ({ canvasElement }) => {
		await userEvent.pointer({
			target: within(canvasElement).getByRole("button", {
				name: "Show current view name",
			}),
			keys: "[MouseRight]",
		});
	},
};

export const ConfirmedAndKept: Story = {
	parameters: {
		queries: [
			{ key: bannerKey, data: { ...MockBanner, dismissible: true } },
			{
				key: announcementStatusKey(MockBanner.id),
				data: {
					signedIn: true,
					username: "admin",
					acked: true,
					viewedAt: "2026-11-17T20:00:00Z",
					certificateFingerprint: "ab".repeat(32),
				},
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

export const SignInPageLongText: Story = {
	...ContinuousLongText,
	args: { placement: "login" },
	decorators: [
		(Story) => (
			<div className="w-[360px]">
				<Story />
			</div>
		),
	],
};

export const SignInPageReadOnce: Story = {
	...ReadLongTextOnce,
	args: { placement: "login" },
};

export const TransparentRollingPicture: Story = {
	parameters: {
		queries: [
			{
				key: bannerKey,
				data: {
					...MockBanner,
					opacity: 30,
					picture: "/pictures/creeper.gif",
					pictureFit: "span",
				},
			},
			{
				key: announcementStatusKey(MockBanner.id),
				data: { signedIn: true, username: "admin", acked: false },
			},
		],
	},
};

export const TransparentStaticPicture: Story = {
	parameters: {
		queries: [
			{
				key: bannerKey,
				data: {
					...MockBanner,
					opacity: 30,
					picture: "/pictures/creeper.gif",
					pictureFit: "fill",
				},
			},
			{
				key: announcementStatusKey(MockBanner.id),
				data: { signedIn: true, username: "admin", acked: false },
			},
		],
	},
};

export const AdministratorEnforcedStill: Story = {
	args: { placement: "navbar" },
	decorators: [
		(Story) => (
			<div className="flex w-[720px]">
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
					message: "Announcements use plain text and a still picture",
					picture: "/pictures/usa.gif",
					pictureFit: "cover",
					pictureEffect: "ripple",
					effect: "wave",
					repeat: true,
					animationsDisabled: true,
					receipts: false,
				},
			},
		],
	},
};
