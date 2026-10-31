import type { Meta, StoryObj } from "@storybook/react-vite";
import { screenShareKey } from "#/api/queries/screenShare";
import { MockUserOwner } from "#/testHelpers/entities";
import { MockScreenShare } from "#/testHelpers/screenShare";
import { withAuthProvider } from "#/testHelpers/storybook";
import { stopMedia } from "./media";
import { ScreenShareController } from "./ScreenShareController";

const meta = {
	title: "modules/platform/ScreenShareController",
	component: ScreenShareController,
	decorators: [withAuthProvider],
	parameters: { user: MockUserOwner },
	beforeEach: () => {
		stopMedia();
		return () => stopMedia();
	},
} satisfies Meta<typeof ScreenShareController>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectedInAnotherTab: Story = {
	parameters: {
		queries: [
			{
				key: screenShareKey,
				data: {
					sessions: [
						{
							...MockScreenShare,
							status: "sharing",
							offer: "v=0\r\nexisting-offer",
							answer: "v=0\r\nexisting-answer",
						},
					],
					iceServers: [],
				},
			},
		],
	},
};

export const FailedSession: Story = {
	parameters: {
		queries: [{ key: screenShareKey, data: { sessions: [], iceServers: [] } }],
	},
	beforeEach: () => {
		stopMedia("Connection failed. End the session and reconnect.");
		return () => stopMedia();
	},
};

export const DashboardControlConsent: Story = {
	parameters: {
		queries: [
			{
				key: screenShareKey,
				data: {
					sessions: [
						{
							...MockScreenShare,
							mode: "dashboard",
							sharer: MockUserOwner.id,
							label: "Coder dashboard",
						},
					],
					iceServers: [],
				},
			},
		],
	},
};

export const RetryDashboardControl: Story = {
	...DashboardControlConsent,
	beforeEach: () => {
		stopMedia("Connection failed. End the session and reconnect.");
		return () => stopMedia();
	},
};
