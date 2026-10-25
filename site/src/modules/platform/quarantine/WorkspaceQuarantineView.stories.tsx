import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import {
	MockQuarantineEnforcement,
	MockWorkspaceQuarantine,
} from "#/testHelpers/workspaceQuarantine";
import { QuarantineEnforcementReport } from "./WorkspaceQuarantine";
import { WorkspaceQuarantineView } from "./WorkspaceQuarantineView";

const meta: Meta<typeof WorkspaceQuarantineView> = {
	title: "modules/platform/WorkspaceQuarantine",
	component: WorkspaceQuarantineView,
	args: {
		name: "developer/workspace",
		enabled: false,
		canManage: true,
		onChange: fn(),
		onRetry: fn(),
	},
};
export default meta;
type Story = StoryObj<typeof WorkspaceQuarantineView>;
export const Released: Story = {};
export const Requested: Story = {
	args: { enabled: true, reason: "Investigating unexpected traffic" },
};
export const ReadOnly: Story = {
	args: { enabled: true, canManage: false, reason: "Security review" },
};
export const Loading: Story = { args: { enabled: undefined, loading: true } };
export const Failed: Story = {
	args: {
		enabled: undefined,
		error: new Error("Quarantine status could not be read"),
	},
};
export const Updating: Story = { args: { busy: true } };
export const Confirmation: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Quarantine workspace",
			}),
		);
	},
};

export const EnforcementUnverified: Story = {
	args: {
		enabled: true,
		children: (
			<QuarantineEnforcementReport
				revision={MockWorkspaceQuarantine.revision}
				report={MockQuarantineEnforcement}
			/>
		),
	},
};
export const PreviousRevision: Story = {
	args: {
		enabled: true,
		children: (
			<QuarantineEnforcementReport
				revision="81d54446-de43-4f6f-a18e-10ca01f7e6bb"
				report={MockQuarantineEnforcement}
			/>
		),
	},
};
