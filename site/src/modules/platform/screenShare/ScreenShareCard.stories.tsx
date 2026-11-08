import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { ScreenShareAPI } from "#/api/screenShare";
import { MockUserOwner } from "#/testHelpers/entities";
import { MockMonitoringOverview } from "#/testHelpers/platform";
import { withAuthProvider } from "#/testHelpers/storybook";
import { stopMedia, updateMedia } from "./media";
import { ScreenShareCard } from "./ScreenShareCard";

const meta: Meta<typeof ScreenShareCard> = {
	title: "modules/platform/ScreenShareCard",
	component: ScreenShareCard,
	args: { overview: MockMonitoringOverview },
	// The workspace search leaves out the signed-in admin's own workspaces.
	decorators: [withAuthProvider],
	parameters: { user: MockUserOwner },
	beforeEach: () => {
		stopMedia();
		return () => stopMedia();
	},
};
export default meta;
type Story = StoryObj<typeof ScreenShareCard>;
export const Standby: Story = {};
export const Waiting: Story = {
	beforeEach: () => {
		updateMedia({ id: "support-preview", status: "Waiting for screen" });
		return () => stopMedia();
	},
};
export const ConnectingTestPattern: Story = {
	...Waiting,
	decorators: [
		(Story) => (
			<>
				<style>
					{".support-test-pattern { animation-play-state: paused; }"}
				</style>
				<Story />
			</>
		),
	],
};
export const ShutdownTransition: Story = {
	beforeEach: () => {
		updateMedia({ id: "shutdown-preview", remote: new MediaStream() });
		return () => stopMedia();
	},
	play: async ({ canvasElement }) => {
		stopMedia();
		for (const animation of canvasElement.getAnimations({ subtree: true })) {
			animation.pause();
			animation.currentTime = 240;
		}
	},
};
export const Empty: Story = {
	args: { overview: { ...MockMonitoringOverview, users: [] } },
};
export const Search: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.type(
			within(canvasElement).getByRole("combobox", {
				name: "Search workspaces or users",
			}),
			"DEV",
		);
	},
};
export const NoMatches: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.type(
			within(canvasElement).getByRole("combobox", {
				name: "Search workspaces or users",
			}),
			"missing workspace",
		);
	},
};
export const Loading: Story = { args: { overview: undefined } };
export const Unavailable: Story = {
	args: {
		overview: undefined,
		error: new Error("Could not retrieve workspaces."),
		onRetry: () => {},
	},
};
export const FailedRequest: Story = {
	beforeEach: () => {
		spyOn(ScreenShareAPI, "update").mockRejectedValue(
			new Error("The user is no longer online."),
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("combobox", { name: "Search workspaces or users" }),
		);
		await userEvent.click(
			within(document.body).getByRole("option", { name: "TestUser2/dev" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Request dashboard control" }),
		);
	},
};
export const DashboardControlLive: Story = {
	beforeEach: () => {
		updateMedia({
			id: "support-preview",
			status: "Live",
			dashboard: true,
			controlReady: true,
			latency: 38,
			capture: "rendered",
			remote: new MediaStream(),
		});
		return () => stopMedia();
	},
};
