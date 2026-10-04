import type { Meta, StoryObj } from "@storybook/react-vite";
import { announcementReportKey, bannerStateKey } from "#/api/queries/platform";
import {
	MockAnnouncementReport,
	MockBanner,
	MockBannerState,
} from "#/testHelpers/platform";
import { withToaster } from "#/testHelpers/storybook";
import AnnouncementSettingsPage from "./AnnouncementSettingsPage";

const meta: Meta<typeof AnnouncementSettingsPage> = {
	title: "pages/DeploymentSettingsPage/AnnouncementSettingsPage",
	component: AnnouncementSettingsPage,
	decorators: [withToaster],
};

export default meta;
type Story = StoryObj<typeof AnnouncementSettingsPage>;

export const Live: Story = {
	parameters: {
		queries: [
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
