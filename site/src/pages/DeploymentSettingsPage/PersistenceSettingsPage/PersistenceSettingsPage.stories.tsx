import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { drKey } from "#/api/queries/disasterRecovery";
import { persistenceReportKey } from "#/api/queries/platform";
import {
	MockDisasterRecovery,
	MockPersistenceReport,
	MockPersistenceReportCloud,
	MockPersistenceReportNeedsAttention,
	MockPersistenceReportNoOperator,
} from "#/testHelpers/platform";
import { withToaster } from "#/testHelpers/storybook";
import PersistenceSettingsPage from "./PersistenceSettingsPage";

const meta: Meta<typeof PersistenceSettingsPage> = {
	title: "pages/DeploymentSettingsPage/PersistenceSettingsPage",
	component: PersistenceSettingsPage,
	decorators: [withToaster],
};

export default meta;
type Story = StoryObj<typeof PersistenceSettingsPage>;

export const HighlyAvailable: Story = {
	parameters: {
		queries: [{ key: persistenceReportKey, data: MockPersistenceReport }],
	},
};

export const NeedsAttention: Story = {
	parameters: {
		queries: [
			{ key: persistenceReportKey, data: MockPersistenceReportNeedsAttention },
		],
	},
};

export const ApproveFixesDialog: Story = {
	parameters: NeedsAttention.parameters,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: /approve suggested fixes/i }),
		);
	},
};

export const ReplicaLagging: Story = {
	parameters: {
		queries: [
			{
				key: persistenceReportKey,
				data: {
					...MockPersistenceReport,
					facts: {
						...MockPersistenceReport.facts,
						instances: MockPersistenceReport.facts.instances.map((i) =>
							i.name === "coder-db-3"
								? { ...i, lagBytes: 340 * 2 ** 20, replicationState: "catchup" }
								: i,
						),
					},
				},
			},
		],
	},
};

export const NoOperator: Story = {
	parameters: {
		queries: [
			{ key: persistenceReportKey, data: MockPersistenceReportNoOperator },
		],
	},
};

export const CloudDatabase: Story = {
	parameters: {
		queries: [{ key: persistenceReportKey, data: MockPersistenceReportCloud }],
	},
};

export const AddBackupTarget: Story = {
	parameters: {
		queries: [
			{ key: persistenceReportKey, data: MockPersistenceReportNeedsAttention },
			{ key: drKey, data: MockDisasterRecovery },
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement).findByRole("button", {
				name: "None scheduled: Add a target",
			}),
		);
	},
};
