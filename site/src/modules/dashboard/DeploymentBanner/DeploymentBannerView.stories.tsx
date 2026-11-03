import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import type {
	AppFamilyName,
	DeploymentStats,
	SessionCountApp,
	SessionCountDeploymentStats,
} from "#/api/typesGenerated";
import {
	Table,
	TableBody,
	TableCell,
	TableRow,
} from "#/components/Table/Table";
import { TableCard } from "#/modules/platform/tableCard/TableCard";
import {
	DeploymentHealthUnhealthy,
	MockDeploymentStats,
	MockHealth,
} from "#/testHelpers/entities";
import { DeploymentBannerView } from "./DeploymentBannerView";

const app = (
	count: number,
	display_name: string,
	family: AppFamilyName = "unknown",
	icon?: string,
): SessionCountApp => ({ count, display_name, family, icon });

/** Zeroes the deprecated family totals, since the banner reads apps. */
const withSessionCount = (
	apps: SessionCountDeploymentStats["apps"],
): DeploymentStats => ({
	...MockDeploymentStats,
	session_count: {
		vscode: 0,
		jetbrains: 0,
		ssh: 0,
		reconnecting_pty: 0,
		apps,
	},
});

const otherApps = withSessionCount({
	...MockDeploymentStats.session_count.apps,
	unknown_app: app(3, "unknown_app"),
	long_name: app(
		1,
		"A workspace application with an intentionally long display name",
	),
	offsite_icon: app(
		1,
		"Offsite Icon",
		"unknown",
		"https://example.com/icon.svg",
	),
	sftp: app(2, "SFTP", "sftp", "/icon/terminal.svg"),
	...Object.fromEntries(
		Array.from({ length: 20 }, (_, i) => [
			`custom_${i}`,
			app(1, `custom_${i}`),
		]),
	),
});

const meta: Meta<typeof DeploymentBannerView> = {
	title: "modules/dashboard/DeploymentBannerView",
	component: DeploymentBannerView,
	args: {
		stats: MockDeploymentStats,
	},
};

export default meta;
type Story = StoryObj<typeof DeploymentBannerView>;

export const Example: Story = {};

export const TableFooter: Story = {
	args: { health: MockHealth },
	render: (args) => (
		<main className="max-w-6xl mx-auto">
			<TableCard
				footerStats={<DeploymentBannerView {...args} />}
				summary="Showing 1 of 1 workspaces"
				hint="Point at anything in the table to read what it does"
			>
				<Table aria-label="Workspaces">
					<TableBody>
						<TableRow>
							<TableCell>Browser</TableCell>
						</TableRow>
					</TableBody>
				</Table>
			</TableCard>
		</main>
	),
};

export const ExpandedTableFooter: Story = {
	...TableFooter,
	play: async ({ canvasElement }) => {
		await userEvent.dblClick(
			within(canvasElement).getByRole("button", {
				name: "Show deployment statistics",
			}),
		);
	},
};
export const Mobile: Story = {
	...ExpandedTableFooter,
	globals: { viewport: { value: "iphone12" } },
};

export const HudTotals: Story = {
	args: { health: MockHealth },
	render: (args) => (
		<div className="max-w-6xl mx-auto overflow-hidden rounded-lg border border-solid border-border bg-surface-secondary/40">
			<div
				data-deployment-footer="hud"
				className="border-0 border-b border-solid border-border"
			>
				<DeploymentBannerView {...args} />
			</div>
			<div className="px-4 py-3 font-mono text-sm">CPU · Memory · GPU</div>
		</div>
	),
};

export const Loading: Story = {
	args: { stats: undefined },
	play: async ({ canvasElement }) => {
		within(canvasElement)
			.getByRole("button", {
				name: "SSH: - loading active connections",
			})
			.focus();
		await waitFor(() => screen.getByRole("tooltip"));
	},
};

export const NoActiveConnections: Story = {
	args: { stats: withSessionCount({}) },
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("button", {
				name: "SSH: 0 active connections",
			}),
		);
		await waitFor(() => screen.getByRole("tooltip"));
	},
};

/** Long names, an offsite icon, a family without a slot, and a scrolling list. */
export const OtherApps: Story = {
	args: { stats: otherApps },
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("button", {
				name: /^Other: \d+ active connections$/,
			}),
		);
		await waitFor(() => screen.getByRole("tooltip"));
	},
};

export const WithHealthIssues: Story = {
	args: {
		health: DeploymentHealthUnhealthy,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const trigger = canvas.getByTestId("deployment-health-trigger");
		await userEvent.hover(trigger);
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
	},
};

export const WithDismissedHealthIssues: Story = {
	args: {
		health: {
			...DeploymentHealthUnhealthy,
			workspace_proxy: {
				...DeploymentHealthUnhealthy.workspace_proxy,
				dismissed: true,
			},
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const trigger = canvas.getByTestId("deployment-health-trigger");
		await userEvent.hover(trigger);
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
	},
};

export const Healthy: Story = { args: { health: MockHealth } };
