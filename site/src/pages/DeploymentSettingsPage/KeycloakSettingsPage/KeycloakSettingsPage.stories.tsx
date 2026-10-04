import type { Meta, StoryObj } from "@storybook/react-vite";
import { keycloakReportKey } from "#/api/queries/platform";
import { MockKeycloakReport } from "#/testHelpers/platform";
import { withToaster } from "#/testHelpers/storybook";
import KeycloakSettingsPage from "./KeycloakSettingsPage";

const meta: Meta<typeof KeycloakSettingsPage> = {
	title: "pages/DeploymentSettingsPage/KeycloakSettingsPage",
	component: KeycloakSettingsPage,
	decorators: [withToaster],
};

export default meta;
type Story = StoryObj<typeof KeycloakSettingsPage>;

export const NeedsFixes: Story = {
	parameters: {
		queries: [{ key: keycloakReportKey, data: MockKeycloakReport }],
	},
};

export const AllGood: Story = {
	parameters: {
		queries: [
			{
				key: keycloakReportKey,
				data: {
					checks: MockKeycloakReport.checks.map((check) => ({
						...check,
						status: "ok",
						fix: null,
					})),
					facts: { ...MockKeycloakReport.facts, envDiffs: [] },
				},
			},
		],
	},
};

export const NotConnected: Story = {
	parameters: {
		queries: [
			{
				key: keycloakReportKey,
				data: {
					checks: [
						{
							id: "kc.admin",
							group: "Connection",
							title: "Keycloak admin access",
							status: "error",
							current: null,
							expected: null,
							detail: "Sign in once with a Keycloak admin account.",
							fix: "kc.connect",
						},
					],
					facts: {
						...MockKeycloakReport.facts,
						keycloakConnected: false,
						envDiffs: [],
					},
				},
			},
		],
	},
};
