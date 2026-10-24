import type { Meta, StoryObj } from "@storybook/react-vite";
import { CloudIcon } from "lucide-react";
import { userEvent, within } from "storybook/test";
import { workspaces } from "#/api/queries/workspaces";
import { workspaceTunnels } from "#/api/queries/workspaceTunnels";
import { MockWorkspace } from "#/testHelpers/entities";
import {
	MockWorkspaceTunnel,
	MockWorkspaceTunnelStats,
} from "#/testHelpers/workspaceTunnels";
import { WorkspaceTunnelGlyph } from "./WorkspaceTunnelGlyph";

const meta: Meta<typeof WorkspaceTunnelGlyph> = {
	title: "modules/platform/WorkspaceTunnelGlyph",
	component: WorkspaceTunnelGlyph,
	args: {
		workspace: {
			...MockWorkspace,
			id: MockWorkspaceTunnel.source_workspace_id,
			name: "Alpha",
		},
	},
	decorators: [
		(Story) => (
			<div className="flex items-center gap-2">
				<span
					role="img"
					aria-label="Cloud Drive"
					className="flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-tertiary px-1 text-content-secondary"
				>
					<CloudIcon className="size-3.5" />
				</span>
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof WorkspaceTunnelGlyph>;
export const Connected: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: { tunnels: [MockWorkspaceTunnel] },
			},
			{
				key: workspaces({ q: "owner:me" }).queryKey,
				data: {
					workspaces: [
						{
							...MockWorkspace,
							id: MockWorkspaceTunnel.target_workspace_id,
							name: "Beta",
						},
					],
					count: 1,
				},
			},
		],
	},
};
export const WaitingForConnection: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: { tunnels: [{ ...MockWorkspaceTunnel, status: "pending" }] },
			},
		],
	},
};

export const Traffic: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						{
							...MockWorkspaceTunnel,
							source_workspace_name: "Alpha",
							target_workspace_name: "Beta",
							source_stats: MockWorkspaceTunnelStats,
						},
					],
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("button", {
				name: "Workspace tunnels: 1 connected",
			}),
		);
	},
};
export const Idle: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						{
							...MockWorkspaceTunnel,
							source_workspace_name: "Alpha",
							target_workspace_name: "Beta",
							source_stats: {
								...MockWorkspaceTunnelStats,
								series: MockWorkspaceTunnelStats.series.map((s) => ({
									...s,
									rx_bytes_per_second: 0,
									tx_bytes_per_second: 0,
								})),
								ports: [],
							},
						},
					],
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("button", {
				name: "Workspace tunnels: 1 connected",
			}),
		);
	},
};
export const Unavailable: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						{
							...MockWorkspaceTunnel,
							source_workspace_name: "Alpha",
							target_workspace_name: "Beta",
							source_stats: null,
						},
					],
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("button", {
				name: "Workspace tunnels: 1 connected",
			}),
		);
	},
};
export const Stale: Story = {
	parameters: {
		queries: [
			{
				key: workspaceTunnels(MockWorkspace.organization_id).queryKey,
				data: {
					tunnels: [
						{
							...MockWorkspaceTunnel,
							source_workspace_name: "Alpha",
							target_workspace_name: "Beta",
							source_stats: { ...MockWorkspaceTunnelStats, stale: true },
						},
					],
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("button", {
				name: "Workspace tunnels: 1 connected",
			}),
		);
	},
};
