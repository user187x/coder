import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
	customNotificationTemplatesKey,
	inboxNotificationsKey,
	notificationDispatchMethodsKey,
	systemNotificationTemplatesKey,
} from "#/api/queries/notifications";
import {
	MockCustomNotificationTemplates,
	MockNotificationMethodsResponse,
	MockNotifications,
	MockSystemNotificationTemplates,
} from "#/testHelpers/entities";
import NotificationsPage from "./NotificationsPage";
import { baseMeta } from "./storybookUtils";

const meta: Meta<typeof NotificationsPage> = {
	title: "pages/DeploymentSettingsPage/NotificationsPage",
	component: NotificationsPage,
	...baseMeta,
};

export default meta;

type Story = StoryObj<typeof NotificationsPage>;

export const LoadingTemplates: Story = {
	parameters: {
		queries: [
			{
				key: systemNotificationTemplatesKey,
				data: undefined,
			},
			{
				key: customNotificationTemplatesKey,
				data: undefined,
			},
			{
				key: notificationDispatchMethodsKey,
				data: MockNotificationMethodsResponse,
			},
		],
	},
};

export const LoadingDispatchMethods: Story = {
	parameters: {
		queries: [
			{
				key: systemNotificationTemplatesKey,
				data: MockSystemNotificationTemplates,
			},
			{
				key: customNotificationTemplatesKey,
				data: MockCustomNotificationTemplates,
			},
			{
				key: notificationDispatchMethodsKey,
				data: undefined,
			},
		],
	},
};

export const Inbox: Story = {
	parameters: {
		queries: [
			...(baseMeta.parameters?.queries ?? []),
			{
				key: inboxNotificationsKey,
				data: { notifications: MockNotifications, unread_count: 2 },
			},
		],
	},
};

export const Events: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.setup().click(await canvas.findByText("Events"));
		// Platform: no links to the online docs (air-gapped).
		await expect(canvas.queryAllByRole("link", { name: /docs/i })).toHaveLength(
			0,
		);
	},
};

export const Configuration: Story = {
	play: async ({ canvasElement }) => {
		const user = userEvent.setup();
		const canvas = within(canvasElement);
		await user.click(await canvas.findByText("Configuration"));
	},
};

export const Toast: Story = {
	play: async ({ canvasElement }) => {
		const user = userEvent.setup();
		const canvas = within(canvasElement);
		await user.click(await canvas.findByText("Toast"));
	},
};
