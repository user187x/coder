import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockWorkspaceTunnel } from "#/testHelpers/workspaceTunnels";
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
];
const meta: Meta<typeof WorkspaceTunnelPorts> = {
	title: "modules/platform/WorkspaceTunnelPorts",
	component: WorkspaceTunnelPorts,
	args: {
		shown,
		cols: 2,
		cellW: 350,
		cellH: 260,
		gap: 12,
		onDragging: () => {},
	},
	decorators: [
		(Story) => (
			<div className="relative grid h-[260px] w-[712px] grid-cols-2 gap-3">
				{shown.map((w) => (
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
			.getByRole("button", { name: "Connect Alpha left tunnel port" })
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
