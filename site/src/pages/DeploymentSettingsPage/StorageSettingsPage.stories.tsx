import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { cloudDriveCleanup, clusterHAKey } from "#/api/clusterNetwork";
import { drKey } from "#/api/queries/disasterRecovery";
import { databaseInventoryKey } from "#/api/queries/platform";
import { MockHAStorageReport } from "#/testHelpers/clusterNetwork";
import { MockPermissions, MockUserOwner } from "#/testHelpers/entities";
import {
	MockDisasterRecovery,
	MockPersistenceReport,
	MockPersistenceReportCloud,
} from "#/testHelpers/platform";
import { withAuthProvider } from "#/testHelpers/storybook";
import StorageSettingsPage from "./StorageSettingsPage";
import "#/dashboardPanel.css";

const MockDatabaseInventory = {
	...MockPersistenceReport,
	facts: {
		...MockPersistenceReport.facts,
		configuration: {
			resources: [
				{
					kind: "Service",
					name: "coder-db-rw",
					namespace: "coder",
					managedBy: "Helm release coder (coder)",
					values: { "spec.clusterIP": "10.43.0.5", "spec.ports[0].port": 5432 },
				},
			],
			unavailable: [],
		},
	},
};

const meta: Meta<typeof StorageSettingsPage> = {
	title: "pages/DeploymentSettingsPage/StorageSettingsPage",
	component: StorageSettingsPage,
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserOwner,
		permissions: MockPermissions,
		layout: "fullscreen",
	},
};

export default meta;
type Story = StoryObj<typeof StorageSettingsPage>;

export const Cluster: Story = {
	parameters: {
		queries: [
			{ key: databaseInventoryKey, data: MockDatabaseInventory },
			{ key: clusterHAKey, data: MockHAStorageReport },
			{ key: drKey, data: MockDisasterRecovery },
			{ key: cloudDriveCleanup().queryKey, data: { scan: null } },
		],
	},
};

export const InspectConnection: Story = {
	parameters: {
		queries: [
			{ key: databaseInventoryKey, data: MockDatabaseInventory },
			{ key: clusterHAKey, data: MockHAStorageReport },
			{ key: drKey, data: MockDisasterRecovery },
			{ key: cloudDriveCleanup().queryKey, data: { scan: null } },
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement).findByRole("button", {
				name: "Inspect database endpoint",
			}),
		);
	},
};

export const External: Story = {
	parameters: {
		queries: [
			{ key: databaseInventoryKey, data: MockPersistenceReportCloud },
			{ key: clusterHAKey, data: MockHAStorageReport },
			{ key: drKey, data: MockDisasterRecovery },
			{ key: cloudDriveCleanup().queryKey, data: { scan: null } },
		],
	},
};

export const InspectVolumeBinding: Story = {
	parameters: {
		queries: [
			{ key: databaseInventoryKey, data: MockDatabaseInventory },
			{ key: clusterHAKey, data: MockHAStorageReport },
			{ key: drKey, data: MockDisasterRecovery },
			{ key: cloudDriveCleanup().queryKey, data: { scan: null } },
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement).findByRole("button", {
				name: "Inspect binding to pv-data",
			}),
		);
	},
};
