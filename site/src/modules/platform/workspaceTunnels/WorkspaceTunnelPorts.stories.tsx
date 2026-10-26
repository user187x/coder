import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import { MockWorkspace } from "#/testHelpers/entities";
import {
	MockWorkspaceTunnel,
	MockWorkspaceTunnelStats,
} from "#/testHelpers/workspaceTunnels";
import { WorkspaceTunnelPorts } from "./WorkspaceTunnelPorts";

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
	{ ...MockWorkspace, id: "third-workspace", name: "Gamma" },
];
const meta: Meta<typeof WorkspaceTunnelPorts> = {
	title: "modules/platform/WorkspaceTunnelPorts",
	component: WorkspaceTunnelPorts,
	args: {
		shown,
		cols: 2,
		cellW: 350,
		cellH: 260,
		gap: 72,
		onDragging: () => {},
	},
	decorators: [
		(Story, { args }) => (
			<div
				className="relative grid"
				style={{
					gridTemplateColumns: `repeat(${args.cols ?? 2}, ${args.cellW ?? 350}px)`,
					gridAutoRows: `${args.cellH ?? 260}px`,
					gap: args.gap ?? 72,
					width:
						(args.cols ?? 2) * (args.cellW ?? 350) +
						((args.cols ?? 2) - 1) * (args.gap ?? 72),
				}}
			>
				{(args.shown ?? shown).map((w) => (
					<div
						key={w.id}
						className="rounded-lg border border-solid border-border bg-surface-primary"
					>
						<div className="border-0 border-b border-solid border-border px-6 py-2 text-sm">
							{w.name}
						</div>
					</div>
				))}
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof WorkspaceTunnelPorts>;
export const Connected: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: { tunnels: [MockWorkspaceTunnel] },
			},
		],
	},
};
export const Pending: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: { tunnels: [{ ...MockWorkspaceTunnel, status: "pending" }] },
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
							error: "Workspace networking helper is unavailable",
						},
					],
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		within(canvasElement)
			.getByRole("button", { name: "Connect Alpha right output tunnel port" })
			.focus();
		await userEvent.keyboard("{Enter}");
	},
};
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
							target_workspace_id: "third-workspace",
						},
					],
				},
			},
		],
	},
};

export const SingleColumnInset: Story = {
	args: { cols: 1, cellW: 240 },
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						{
							...MockWorkspaceTunnel,
							source_side: "right",
							target_side: "right",
						},
					],
				},
			},
		],
	},
};

export const MemberOwnWorkspaces: Story = {
	args: { canManage: false, actorId: MockWorkspace.owner_id },
	parameters: Connected.parameters,
};

export const ListConnected: Story = {
	args: {
		shown: shown.slice(0, 2),
		cols: 1,
		cellW: 500,
		cellH: 260,
		gap: 24,
		listMode: true,
	},
	parameters: Connected.parameters,
	decorators: [
		(Story) => (
			<div className="pr-[72px]">
				<Story />
			</div>
		),
	],
};

export const IdleRetractableInputs: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: { tunnels: [] },
			},
		],
	},
};

export const ConnectionDetails: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						{
							...MockWorkspaceTunnel,
							source_stats: {
								...MockWorkspaceTunnelStats,
								rx_bytes: 1048576,
								tx_bytes: 524288,
							},
							target_stats: MockWorkspaceTunnelStats,
						},
					],
				},
			},
		],
	},
	play: async () => {
		const page = within(document.body);
		await userEvent.pointer({
			target: await page.findByRole("button", {
				name: "Manage tunnel Alpha to Beta: ready",
			}),
			keys: "[MouseRight]",
		});
		await userEvent.click(
			page.getByRole("menuitem", { name: "View connection" }),
		);
	},
};
