import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WorkspaceTunnel } from "#/api/platform";
import { workspacePortShares } from "#/api/queries/workspaceportsharing";
import { workspacesKey } from "#/api/queries/workspaces";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import type { Workspace } from "#/api/typesGenerated";
import { MockUserMember, MockWorkspace } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import TrafficControlPage from "./TrafficControlPage";

const workspace = (id: string, running = true): Workspace => ({
	...MockWorkspace,
	id,
	name: id,
	latest_build: {
		...MockWorkspace.latest_build,
		status: running ? "running" : "stopped",
	},
});

const live = (tx: number, rx: number) => ({
	updated_at: 0,
	stale: false,
	ports: [],
	series: [{ timestamp: 0, rx_bytes_per_second: rx, tx_bytes_per_second: tx }],
});

const tunnel = (
	id: string,
	source: string,
	target: string,
	over: Partial<WorkspaceTunnel>,
): WorkspaceTunnel => ({
	id,
	organization_id: MockWorkspace.organization_id,
	source_workspace_id: source,
	target_workspace_id: target,
	status: "ready",
	...over,
});

const share = (workspace_id: string, port: number, share_level: string) => ({
	workspace_id,
	agent_name: "main",
	port,
	share_level,
	protocol: "http",
});

const meta: Meta<typeof TrafficControlPage> = {
	title: "pages/TrafficControlPage",
	component: TrafficControlPage,
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserMember,
		permissions: {},
		queries: [
			{
				key: workspacesKey({ q: "owner:me" }),
				data: {
					workspaces: [
						workspace("frontend"),
						workspace("api"),
						workspace("postgres"),
						workspace("notebook"),
						workspace("scratch", false),
					],
					count: 5,
				},
			},
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						tunnel("t1", "frontend", "api", {
							ports: [
								{ protocol: "tcp", port: 8080 },
								{ protocol: "tcp", port: 50051 },
							],
							source_stats: live(48_000, 9_000),
						}),
						tunnel("t2", "api", "postgres", {
							ports: [{ protocol: "tcp", port: 5432 }],
							source_stats: live(2_000, 120_000),
						}),
						tunnel("t3", "notebook", "postgres", {
							ports: null,
							status: "pending",
							error: "Waiting for both workspaces to be running and connected.",
						}),
					],
				},
			},
			{
				key: workspacePortShares("frontend").queryKey,
				data: {
					shares: [
						share("frontend", 3000, "public"),
						share("frontend", 8443, "authenticated"),
					],
				},
			},
			{
				key: workspacePortShares("notebook").queryKey,
				data: { shares: [share("notebook", 8888, "owner")] },
			},
			{ key: workspacePortShares("api").queryKey, data: { shares: [] } },
			{ key: workspacePortShares("postgres").queryKey, data: { shares: [] } },
		],
	},
};

export default meta;
type Story = StoryObj<typeof TrafficControlPage>;

export const Default: Story = {};

export const NoWorkspaces: Story = {
	parameters: {
		queries: [
			{
				key: workspacesKey({ q: "owner:me" }),
				data: { workspaces: [], count: 0 },
			},
		],
	},
};
