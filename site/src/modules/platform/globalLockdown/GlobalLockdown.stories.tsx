import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { reactRouterParameters } from "storybook-addon-remix-react-router";
import { globalLockdownKey } from "#/api/queries/globalLockdown";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockGlobalLockdownState } from "#/testHelpers/globalLockdown";
import {
	GlobalLockdownCardView,
	GlobalLockdownGate,
	GlobalLockdownNotice,
} from "./GlobalLockdown";
import { GlobalWorkspaceActionsView } from "./GlobalWorkspaceActions";

const meta: Meta<typeof GlobalLockdownCardView> = {
	title: "modules/platform/GlobalLockdown",
	component: GlobalLockdownCardView,
	args: {
		state: MockGlobalLockdownState,
		workspaceActions: (
			<GlobalWorkspaceActionsView workspaces={[MockWorkspace]} onRun={fn()} />
		),
		onChange: fn(),
	},
};

export default meta;
type Story = StoryObj<typeof GlobalLockdownCardView>;

export const Unlocked: Story = {};

export const Disconnecting: Story = {
	args: { state: { ...MockGlobalLockdownState, enabled: true } },
};

export const AgentUpdateRequired: Story = {
	args: {
		state: {
			...MockGlobalLockdownState,
			enabled: true,
			agents_pending: 1,
			agents: [
				{
					id: "agent-1",
					name: "developer/workspace/main",
					state: "update_required",
				},
			],
		},
	},
};

export const Disconnected: Story = {
	args: {
		state: {
			...MockGlobalLockdownState,
			enabled: true,
			confirmed: true,
			users: MockGlobalLockdownState.users?.map((user) =>
				user.admin ? user : { ...user, connected: false, disconnected: true },
			),
		},
	},
};

export const Loading: Story = { args: { state: undefined, loading: true } };
export const Empty: Story = {
	args: { state: { ...MockGlobalLockdownState, users: [] } },
};
export const ReadError: Story = {
	args: { error: new Error("The lockdown state could not be read.") },
};
export const ConfirmLock: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Lock" }),
		);
	},
};
export const LockdownBanner: Story = {
	render: () => <GlobalLockdownNotice />,
};

export const LockedWorkspace: Story = {
	parameters: {
		reactRouter: reactRouterParameters({
			location: { path: "/@developer/workspace" },
			routing: { path: "/@developer/workspace" },
		}),
		queries: [
			{
				key: globalLockdownKey,
				data: { ...MockGlobalLockdownState, enabled: true, admin: false },
			},
		],
	},
	render: () => (
		<GlobalLockdownGate>
			<div>Workspace</div>
		</GlobalLockdownGate>
	),
};

export const OfflineUsers: Story = {
	args: {
		state: {
			...MockGlobalLockdownState,
			users: MockGlobalLockdownState.users?.map((user) => ({
				...user,
				connected: false,
				disconnected: false,
			})),
		},
	},
};
