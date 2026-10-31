import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { announcementReportKey, bannerStateKey } from "#/api/queries/platform";
import { usersKey } from "#/api/queries/users";
import { MockUserOwner } from "#/testHelpers/entities";
import {
	MockAnnouncementReport,
	MockBanner,
	MockBannerState,
} from "#/testHelpers/platform";
import { withAuthProvider, withToaster } from "#/testHelpers/storybook";
import AnnouncementSettingsPage from "./AnnouncementSettingsPage";

const meta: Meta<typeof AnnouncementSettingsPage> = {
	title: "pages/DeploymentSettingsPage/AnnouncementSettingsPage",
	component: AnnouncementSettingsPage,
	decorators: [withAuthProvider, withToaster],
	parameters: {
		user: MockUserOwner,
		permissions: { editDeploymentConfig: true },
	},
};

export default meta;
type Story = StoryObj<typeof AnnouncementSettingsPage>;

export const Live: Story = {
	parameters: {
		queries: [
			{
				key: usersKey({ q: "status:active", limit: 25 }),
				data: { users: [MockUserOwner], count: 1 },
			},
			{ key: bannerStateKey, data: MockBannerState },
			{ key: announcementReportKey, data: MockAnnouncementReport },
		],
	},
};

export const Hidden: Story = {
	parameters: {
		queries: [
			{
				key: bannerStateKey,
				data: {
					...MockBannerState,
					banner: { ...MockBanner, enabled: false },
				},
			},
			{
				key: announcementReportKey,
				data: { ...MockAnnouncementReport, current: null, events: [] },
			},
		],
	},
};

export const CustomColors: Story = {
	parameters: {
		queries: [
			{
				key: bannerStateKey,
				data: {
					...MockBannerState,
					banner: {
						...MockBanner,
						title: "{{colors bg=#4c1d95 fg=#fef3c7}}",
						dismissible: false,
					},
				},
			},
			{ key: announcementReportKey, data: MockAnnouncementReport },
		],
	},
};

export const PreviewDraft: Story = {
	...Live,
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Preview",
			}),
		);
	},
};

export const RecordingDisabled: Story = {
	parameters: {
		queries: [
			{
				key: bannerStateKey,
				data: {
					...MockBannerState,
					banner: { ...MockBanner, receipts: false },
				},
			},
			{ key: announcementReportKey, data: MockAnnouncementReport },
		],
	},
	play: async ({ canvasElement }) => {
		within(canvasElement)
			.getByRole("region", { name: "Acknowledgements" })
			.scrollIntoView({ block: "center", behavior: "instant" });
	},
};

export const EnforcedStillAnnouncements: Story = {
	parameters: {
		queries: [
			{
				key: bannerStateKey,
				data: {
					...MockBannerState,
					banner: { ...MockBanner, animationsDisabled: true },
				},
			},
		],
	},
};
