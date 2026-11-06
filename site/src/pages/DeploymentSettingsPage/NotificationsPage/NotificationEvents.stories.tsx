import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { selectTemplatesByGroup } from "#/api/queries/notifications";
import type { DeploymentValues } from "#/api/typesGenerated";
import { MockSystemNotificationTemplates } from "#/testHelpers/entities";
import { NotificationEvents } from "./NotificationEvents";
import { baseMeta } from "./storybookUtils";

const meta: Meta<typeof NotificationEvents> = {
	title: "pages/DeploymentSettingsPage/NotificationsPage/NotificationEvents",
	component: NotificationEvents,
	args: {
		defaultMethod: "smtp",
		availableMethods: ["smtp", "webhook"],
		templatesByGroup: selectTemplatesByGroup(MockSystemNotificationTemplates),
		deploymentConfig: baseMeta.parameters.deploymentValues,
	},
	...baseMeta,
};

export default meta;

type Story = StoryObj<typeof NotificationEvents>;

export const SMTPNotConfigured: Story = {
	args: {
		deploymentConfig: {
			notifications: {
				webhook: {
					endpoint: "https://example.com",
				},
				email: {
					smarthost: "",
				},
			},
		} as DeploymentValues,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// Platform: no links to the online docs (air-gapped).
		await expect(canvas.queryAllByRole("link", { name: /docs/i })).toHaveLength(
			0,
		);
	},
};

export const WebhookNotConfigured: Story = {
	args: {
		deploymentConfig: {
			notifications: {
				webhook: {
					endpoint: "",
				},
				email: {
					smarthost: "smtp.example.com",
					from: "bob@localhost",
					hello: "localhost",
				},
			},
		} as DeploymentValues,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// Platform: no links to the online docs (air-gapped).
		await expect(canvas.queryAllByRole("link", { name: /docs/i })).toHaveLength(
			0,
		);
	},
};
