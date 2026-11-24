import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { fn, spyOn, userEvent, within } from "storybook/test";
import { reactRouterParameters } from "storybook-addon-remix-react-router";
import { PlatformAPI } from "#/api/platform";
import {
	bannerKey,
	clusterUsage,
	hudHistory,
	userUIPreferences,
} from "#/api/queries/platform";
import { myAppearanceKey } from "#/api/queries/users";
import { workspaces } from "#/api/queries/workspaces";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import DeploymentSettingsLayout from "#/modules/management/DeploymentSettingsLayout";
import { startNavbarArrange } from "#/modules/platform/navbarOrder/navbarOrder";
import {
	MockBuildInfo,
	MockPermissions,
	MockUserAppearanceSettings,
	MockUserMember,
	MockUserOwner,
	MockWorkspace,
} from "#/testHelpers/entities";
import { MockHudHistory } from "#/testHelpers/hud";
import { pixelWithDesktop, pixelWithTablet } from "#/testHelpers/pixel";
import { MockBanner, MockClusterUsage } from "#/testHelpers/platform";
import {
	withAuthProvider,
	withDashboardProvider,
} from "#/testHelpers/storybook";
import { adminPagesFor, resolveAdminQuickLinks } from "./adminQuickLinks";
import {
	NavbarAction,
	NavbarActionTarget,
	NavbarStartTarget,
} from "./NavbarAction";
import { NavbarView } from "./NavbarView";

const adminPages = adminPagesFor({
	permissions: MockPermissions,
	oauth2Provider: true,
});

const meta: Meta<typeof NavbarView> = {
	title: "modules/dashboard/NavbarView",
	parameters: {
		pixel: { matrix: pixelWithTablet },
		layout: "fullscreen",
	},
	component: NavbarView,
	args: {
		user: MockUserOwner,
		adminPermissions: {
			canViewHud: true,
			canViewOrganizations: true,
			canViewUsers: true,
			canViewAuditLog: true,
			canViewConnectionLog: true,
			canViewHealth: true,
		},
		supportLinks: [],
	},
	decorators: [withDashboardProvider],
};

export default meta;
type Story = StoryObj<typeof NavbarView>;

export const ForAdmin: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
	},
};

export const ResourcesMenu: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Resources" }));
	},
};

export const ResourcesContextMenu: Story = {
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					navbar_layout: {
						order: ["logo", "banner", "workspaces"],
						hidden: [],
					},
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.pointer({
			target: within(canvasElement).getByRole("button", { name: "Resources" }),
			keys: "[MouseRight]",
		});
	},
};

export const ResizableWithoutBackstrip: Story = {
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					navbar_floating: true,
					navbar_strip_off: true,
					navbar_resizable_width: 100,
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("separator", {
				name: /from its right end/,
			}),
		);
	},
};

export const BreadcrumbFacingAnnouncement: Story = {
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserOwner,
		permissions: MockPermissions,
		pixel: { matrix: pixelWithDesktop },
		reactRouter: reactRouterParameters({
			location: { path: "/traffic-control" },
			routing: { path: "/traffic-control" },
		}),
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					settings_sidebar: true,
					navbar_floating: true,
					navbar_settings_side: "left",
					navbar_layout: {
						order: ["banner", "workspaces", "logo"],
						hidden: [],
					},
				},
			},
			{ key: bannerKey, data: { ...MockBanner, receipts: false } },
		],
	},
};
export const MinimumResizableWidth: Story = {
	...BreadcrumbFacingAnnouncement,
	parameters: {
		...BreadcrumbFacingAnnouncement.parameters,
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					navbar_floating: true,
					navbar_resizable_width: 20,
					navbar_layout: {
						order: ["settings-chevrons", "banner", "action"],
						hidden: ["logo", "workspaces", "notifications", "account"],
					},
				},
			},
			{ key: bannerKey, data: { ...MockBanner, receipts: false } },
		],
	},
};

export const PingAndLatencyBreadcrumb: Story = {
	...MinimumResizableWidth,
	parameters: {
		...MinimumResizableWidth.parameters,
		reactRouter: reactRouterParameters({
			location: { path: "/hud/latency" },
			routing: { path: "/hud/latency" },
		}),
	},
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("button", { name: "Ping and Latency" }),
		);
	},
};

export const CategoryDropdown: Story = {
	...PingAndLatencyBreadcrumb,
	args: {
		adminQuickLinks: {
			links: [],
			categories: adminPages,
			pages: adminPages,
			onChange: fn(),
		},
	},
	parameters: {
		...PingAndLatencyBreadcrumb.parameters,
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: { settings_sidebar: true, navbar_floating: true },
			},
			{ key: bannerKey, data: { ...MockBanner, receipts: false } },
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Ping and Latency" }),
		);
		const menu = await within(canvasElement.ownerDocument.body).findByRole(
			"menu",
			{ name: "Settings categories" },
		);
		await userEvent.hover(
			within(menu).getByRole("menuitem", { name: "Profile" }),
		);
	},
};

export const SettingsBetweenAnnouncementAndLogo: Story = {
	...BreadcrumbFacingAnnouncement,
	parameters: {
		...BreadcrumbFacingAnnouncement.parameters,
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					settings_sidebar: true,
					navbar_settings_side: "left",
					navbar_layout: {
						order: ["banner", "settings-chevrons", "logo"],
						hidden: ["workspaces", "notifications", "account"],
					},
				},
			},
			{ key: bannerKey, data: { ...MockBanner, receipts: false } },
		],
	},
};

export const MirroredBreadcrumbFacingAnnouncement: Story = {
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserOwner,
		permissions: MockPermissions,
		pixel: { matrix: pixelWithDesktop },
		reactRouter: reactRouterParameters({
			location: { path: "/traffic-control" },
			routing: { path: "/traffic-control" },
		}),
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					settings_sidebar: true,
					navbar_floating: true,
					navbar_settings_side: "right",
					navbar_layout: {
						order: ["logo", "workspaces", "notifications", "account", "banner"],
						hidden: [],
					},
				},
			},
			{ key: bannerKey, data: { ...MockBanner, receipts: false } },
		],
	},
};

export const SecurityChevronFacingAnnouncement: Story = {
	...BreadcrumbFacingAnnouncement,
	parameters: {
		...BreadcrumbFacingAnnouncement.parameters,
		reactRouter: reactRouterParameters({
			location: { path: "/deployment/security" },
			routing: { path: "/deployment/security" },
		}),
	},
	render: function Render(args) {
		const [target, setTarget] = useState<HTMLDivElement | null>(null);
		return (
			<NavbarStartTarget.Provider value={target}>
				<div className="@container/dashboard dashboard-frame">
					<NavbarView {...args} startRef={setTarget} />
					<DeploymentSettingsLayout />
				</div>
			</NavbarStartTarget.Provider>
		);
	},
};

export const AccountActionAlignment: Story = {
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserOwner,
		permissions: MockPermissions,
		pixel: { matrix: pixelWithDesktop },
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					admin_nav_in_navbar: true,
					navbar_layout: { order: ["action", "banner"], hidden: [] },
				},
			},
			{
				key: bannerKey,
				data: {
					...MockBanner,
					receipts: false,
					message: "Platform announcement",
				},
			},
		],
	},
	render: function Render(args) {
		const [target, setTarget] = useState<HTMLDivElement | null>(null);
		return (
			<NavbarActionTarget.Provider value={target}>
				<div className="@container/dashboard">
					<NavbarView {...args} actionRef={setTarget} />
				</div>
				<NavbarAction>
					<Button>
						<UserPlusIcon aria-hidden />
						New account
						<ChevronDownIcon aria-hidden />
					</Button>
				</NavbarAction>
			</NavbarActionTarget.Provider>
		);
	},
};

export const AccountActionMovedAcrossAnnouncement: Story = {
	...AccountActionAlignment,
	beforeEach: () => {
		spyOn(PlatformAPI, "setUserUIPreferences").mockImplementation(
			async (value) => value,
		);
	},
	play: async ({ canvasElement }) => {
		startNavbarArrange();
		const canvas = within(canvasElement);
		const action = await canvas.findByRole("button", {
			name: "Move Action",
		});
		action.focus();
		await userEvent.keyboard("{ArrowRight}{Enter}");
		await canvas.findByRole("button", { name: "New account" });
	},
};

export const RightAccountActionAlignment: Story = {
	...AccountActionAlignment,
	parameters: {
		...AccountActionAlignment.parameters,
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					admin_nav_in_navbar: true,
					navbar_settings_side: "right",
					settings_default_view: "/dashboard",
				},
			},
			{
				key: bannerKey,
				data: {
					...MockBanner,
					receipts: false,
					message: "Platform announcement",
				},
			},
		],
	},
};

export const ScaledAccountActionAlignment: Story = {
	...AccountActionAlignment,
	args: { scale: 120 },
};

const compactHistoryStart = 1_780_000_000;
const compactHudPoints = MockHudHistory.points
	.slice(-60)
	.map((point, index) => ({
		...point,
		t: compactHistoryStart + index * 15,
	}));

export const CompactDockWithoutPageAction: Story = {
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		queries: [
			{
				key: clusterUsage().queryKey,
				data: {
					...MockClusterUsage,
					history: {
						every: 15,
						points: compactHudPoints.map((point, index) => ({
							t: point.t,
							cpu: MockClusterUsage.cpu.used + (index % 7) / 10,
							cpuTotal: MockClusterUsage.cpu.total,
							memory: MockClusterUsage.memory.used,
							memoryTotal: MockClusterUsage.memory.total,
						})),
					},
					network: {
						rx: 4200,
						tx: 1500,
						every: 15,
						points: Array.from({ length: 60 }, (_, index) => ({
							t: compactHistoryStart + index * 15,
							rx: 4200 - (index % 7) * 400,
							tx: 1500 + (index % 3) * 350,
						})),
					},
				},
			},
			{
				key: hudHistory("15m").queryKey,
				data: {
					...MockHudHistory,
					range: "15m",
					start: compactHistoryStart,
					end: compactHistoryStart + 900,
					step: 15,
					points: compactHudPoints,
				},
			},
			{
				key: userUIPreferences().queryKey,
				data: {
					settings_sidebar: true,
					settings_sidebar_compact: true,
					navbar_layout: {
						order: ["workspaces", "latency"],
						hidden: ["logo", "banner", "notifications", "account"],
					},
				},
			},
		],
	},
	render: (args) => (
		<>
			<NavbarView {...args} />
			<main id="main-content" className="p-6">
				<section className="rounded-lg border border-solid border-border p-4">
					Message
				</section>
			</main>
		</>
	),
};

export const CompactSettingsDockOptions: Story = {
	...CompactDockWithoutPageAction,
	beforeEach: () => {
		spyOn(PlatformAPI, "setUserUIPreferences").mockImplementation(
			async (changes) => ({
				settings_sidebar: true,
				settings_sidebar_compact: true,
				...changes,
			}),
		);
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const key = await body.findByRole("menuitem", {
			name: "Expand Settings sidebar",
		});
		await userEvent.pointer({ target: key, keys: "[MouseRight]" });
	},
};

export const CompactAppearanceQuickLink: Story = {
	...CompactDockWithoutPageAction,
	args: {
		adminQuickLinks: {
			pages: adminPages,
			links: resolveAdminQuickLinks(["customize"], adminPages),
			onChange: fn(),
		},
	},
	parameters: {
		...CompactDockWithoutPageAction.parameters,
		queries: [
			...(CompactDockWithoutPageAction.parameters?.queries ?? []),
			{ key: myAppearanceKey, data: MockUserAppearanceSettings },
			{
				key: workspaces({ q: "owner:me" }).queryKey,
				data: { workspaces: [MockWorkspace], count: 1 },
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.pointer({
			target: await within(canvasElement.ownerDocument.body).findByRole(
				"menuitem",
				{ name: "Appearance" },
			),
			keys: "[MouseRight]",
		});
	},
};

export const CompactWorkspacesQuickLink: Story = {
	...CompactAppearanceQuickLink,
	play: async ({ canvasElement }) => {
		await userEvent.pointer({
			target: await within(canvasElement.ownerDocument.body).findByRole(
				"menuitem",
				{ name: /^Workspaces$/ },
			),
			keys: "[MouseRight]",
		});
	},
};

export const CompactNetworkRange: Story = {
	...CompactDockWithoutPageAction,
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const graph = await body.findByRole("menuitem", {
			name: "Cluster network",
		});
		const { x, y, width, height } = graph.getBoundingClientRect();
		await userEvent.pointer([
			{
				target: graph,
				coords: { clientX: x + width / 2, clientY: y + height / 4 },
				keys: "[MouseLeft>]",
			},
			{
				target: graph,
				coords: { clientX: x + width / 2, clientY: y + (3 * height) / 4 },
			},
			{ keys: "[/MouseLeft]" },
		]);
	},
};

export const ForAdminWithoutQuickLinks: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: {
		adminQuickLinks: { pages: adminPages, links: [], onChange: fn() },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
	},
};

export const ForAdminWithQuickLinks: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: {
		adminQuickLinks: {
			pages: adminPages,
			links: resolveAdminQuickLinks(
				["announcement", "health", "monitoring"],
				adminPages,
			),
			onChange: fn(),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
	},
};

export const DockedWithControlsCollapsed: Story = {
	args: ForAdminWithQuickLinks.args,
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		queries: [
			{ key: clusterUsage().queryKey, data: MockClusterUsage },
			{ key: hudHistory("15m").queryKey, data: MockHudHistory },
			{
				key: userUIPreferences().queryKey,
				data: {
					settings_sidebar: true,
					navbar_settings_side: "left",
					settings_face_collapse_direction: "up",
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "Collapse quick links" }),
		);
	},
};

export const QuickLinkWithDefaultBadge: Story = {
	...ForAdminWithQuickLinks,
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: { settings_default_view: "/health" },
			},
		],
	},
};

export const RemovingQuickLink: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: ForAdminWithQuickLinks.args,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
		const body = within(canvasElement.ownerDocument.body);
		// A row's remove and move controls show while it is pointed at.
		await userEvent.hover(
			await body.findByRole("menuitem", { name: "Health" }),
		);
		await userEvent.click(
			await body.findByRole("menuitem", {
				name: "Remove Health from the quick links",
			}),
		);
	},
};

export const AddingQuickLink: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: ForAdminWithQuickLinks.args,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "Controls" }),
		);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "Security" }),
		);
	},
};

export const ReorderingQuickLinkWithKeyboard: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: ForAdminWithQuickLinks.args,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
		const body = within(canvasElement.ownerDocument.body);
		// A row's move control shows while the row is pointed at or holds the focus.
		await userEvent.hover(
			await body.findByRole("menuitem", { name: "Monitoring" }),
		);
		(await body.findByRole("menuitem", { name: "Reorder Monitoring" })).focus();
		await userEvent.keyboard("{Enter}{ArrowUp}");
	},
};

export const ForAuditor: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: {
		user: MockUserMember,
		adminPermissions: {
			canViewAuditLog: true,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
	},
};

export const ForOrgAdmin: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: {
		user: MockUserMember,
		adminPermissions: {
			canViewAuditLog: true,
			canViewOrganizations: true,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
	},
};

export const ForSingleOrgOSSAdmin: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: {
		adminPermissions: {
			canViewHud: true,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
	},
};

export const ForUserWithoutOrganization: Story = {
	args: {
		user: MockUserMember,
		adminPermissions: {},
	},
};

export const ForMember: Story = {
	args: {
		user: MockUserMember,
		adminPermissions: {},
	},
};

export const SupportLinks: Story = {
	args: {
		user: MockUserMember,
		adminPermissions: {},
		supportLinks: [
			{
				name: "This is a bug",
				icon: "bug",
				target: "#",
			},
			{
				name: "This is a star",
				icon: "star",
				target: "#",
				location: "navbar",
			},
			{
				name: "This is a chat",
				icon: "chat",
				target: "#",
				location: "navbar",
			},
			{
				name: "No icon here",
				icon: "",
				target: "#",
				location: "navbar",
			},
			{
				name: "No icon here too",
				icon: "",
				target: "#",
			},
		],
	},
};

export const DefaultSupportLinks: Story = {
	args: {
		user: MockUserMember,
		adminPermissions: {},
		supportLinks: [
			{ icon: "docs", name: "Documentation", target: "" },
			{ icon: "bug", name: "Report a bug", target: "" },
			{
				icon: "chat",
				name: "Join the Coder Discord",
				target: "",
				location: "navbar",
			},
			{ icon: "star", name: "Star the Repo", target: "" },
		],
	},
};

export const DevelBuild: Story = {
	args: {
		buildInfo: {
			...MockBuildInfo,
			version: "v2.21.0-devel+abc123",
			external_url: "https://github.com/coder/coder/commit/abc123",
		},
	},
};

export const RcBuild: Story = {
	args: {
		buildInfo: {
			...MockBuildInfo,
			version: "v2.21.0-rc.1+def456",
			external_url: "https://github.com/coder/coder/releases/tag/v2.21.0-rc.1",
		},
	},
};

export const RcDevelBuild: Story = {
	args: {
		buildInfo: {
			...MockBuildInfo,
			version: "v2.33.0-rc.1-devel+727ec00f7",
			external_url: "https://github.com/coder/coder/commit/727ec00f7",
		},
	},
};

export const SettingsChoicesExpanded: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: ForAdminWithQuickLinks.args,
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: /^Settings/ }),
		);
		await userEvent.click(
			await within(canvasElement.ownerDocument.body).findByRole("menuitem", {
				name: "Controls",
			}),
		);
	},
};

export const CustomizeToolbar: Story = {
	render: (args) => (
		<>
			<NavbarView {...args} />
			<main className="mx-auto max-w-6xl space-y-6 p-8">
				<h1>Workspaces</h1>
				<p>Manage your development environments and shared resources.</p>
				<section className="rounded-xl border border-solid border-border bg-surface-secondary p-6">
					<h2>Workspace resources</h2>
					<p>
						Choose a workspace to view its applications, usage, and connection
						status.
					</p>
					<button type="button">Create a workspace</button>
				</section>
			</main>
		</>
	),
	parameters: { queries: [{ key: userUIPreferences().queryKey, data: {} }] },
	beforeEach: () => {
		spyOn(PlatformAPI, "setUserUIPreferences").mockImplementation(
			async (value) => value,
		);
	},
	play: async ({ canvasElement }) => {
		startNavbarArrange();
		await userEvent.click(
			await within(canvasElement.ownerDocument.body).findByRole("button", {
				name: "Add divider",
			}),
		);
	},
};
