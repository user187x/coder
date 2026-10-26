import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import { TableCard } from "#/modules/platform/tableCard/TableCard";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockWorkspaceTunnel } from "#/testHelpers/workspaceTunnels";
import {
	WorkspaceTableTunnels,
	WorkspaceTunnelStatus,
} from "./WorkspaceTableTunnels";

const shown = [
	{
		...MockWorkspace,
		id: MockWorkspaceTunnel.source_workspace_id,
		name: "Alpha",
	},
	{
		...MockWorkspace,
		id: MockWorkspaceTunnel.target_workspace_id,
		name: "Beta",
	},
	{ ...MockWorkspace, id: "unconnected-workspace", name: "Gamma" },
];
const meta: Meta<typeof WorkspaceTableTunnels> = {
	title: "modules/platform/WorkspaceTableTunnels",
	component: WorkspaceTableTunnels,
	args: {
		shown,
		canManage: true,
		children: (
			<TableCard>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[560px] border-separate border-spacing-0 rounded-lg border border-solid border-border">
						<thead>
							<tr>
								<th className="h-12 text-left">Workspace</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{shown.map((w) => (
								<tr key={w.id} data-workspace-tunnel-row={w.id}>
									<td className="h-20 border-0 border-t border-solid border-border px-3">
										{w.name}
									</td>
									<td className="border-0 border-t border-solid border-border text-center">
										Running
										<br />
										<WorkspaceTunnelStatus workspaceId={w.id} />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</TableCard>
		),
	},
	decorators: [
		(Story) => (
			<div className="w-[600px] max-w-full">
				<Story />
			</div>
		),
	],
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: { tunnels: [MockWorkspaceTunnel] },
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof WorkspaceTableTunnels>;
export const Connected: Story = {};
export const Establishing: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: { tunnels: [{ ...MockWorkspaceTunnel, status: "pending" }] },
			},
		],
	},
};
export const Decommissioning: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [{ ...MockWorkspaceTunnel, status: "disconnecting" }],
				},
			},
		],
	},
};
export const Failed: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						{
							...MockWorkspaceTunnel,
							status: "error",
							error: "Peer helper did not acknowledge the connection",
						},
					],
				},
			},
		],
	},
};
export const ReadOnly: Story = { args: { canManage: false } };
export const Empty: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: { tunnels: [] },
			},
		],
	},
};

export const NarrowScrolled: Story = {
	decorators: [
		(Story) => (
			<div className="w-[320px]">
				<Story />
			</div>
		),
	],
	play: async ({ canvasElement }) => {
		within(canvasElement)
			.getByRole("table")
			.parentElement?.scrollTo({ left: 180 });
	},
};

export const MultipleConnections: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						MockWorkspaceTunnel,
						{
							...MockWorkspaceTunnel,
							id: "second-tunnel",
							target_workspace_id: "unconnected-workspace",
						},
					],
				},
			},
		],
	},
};

export const ConnectionOutsideView: Story = {
	args: { shown: [shown[0]] },
};

export const TwoIncomingOneOutgoing: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						MockWorkspaceTunnel,
						{
							...MockWorkspaceTunnel,
							id: "incoming-one",
							source_workspace_id: shown[1].id,
							target_workspace_id: shown[0].id,
							source_workspace_name: "Beta",
							target_workspace_name: "Alpha",
						},
						{
							...MockWorkspaceTunnel,
							id: "incoming-two",
							source_workspace_id: shown[2].id,
							target_workspace_id: shown[0].id,
							source_workspace_name: "Gamma",
							target_workspace_name: "Alpha",
						},
					],
				},
			},
		],
	},
};
export const FlowOverview: Story = {
	...TwoIncomingOneOutgoing,
	play: async ({ canvasElement }) => {
		const { userEvent } = await import("storybook/test");
		await userEvent.hover(
			within(canvasElement).getByRole("button", {
				name: "3 tunnels connected. 2 incoming, 1 outgoing",
			}),
		);
	},
};
