import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { fn, spyOn, userEvent, within } from "storybook/test";
import { PlatformAPI } from "#/api/platform";
import { bannerKey, userUIPreferences } from "#/api/queries/platform";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import { startNavbarArrange } from "#/modules/platform/navbarOrder/navbarOrder";
import {
	MockBuildInfo,
	MockPermissions,
	MockUserMember,
	MockUserOwner,
} from "#/testHelpers/entities";
import { pixelWithDesktop, pixelWithTablet } from "#/testHelpers/pixel";
import { MockBanner } from "#/testHelpers/platform";
import { withDashboardProvider } from "#/testHelpers/storybook";
import { adminPagesFor, resolveAdminQuickLinks } from "./adminQuickLinks";
import { NavbarAction, NavbarActionTarget } from "./NavbarAction";
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

export const AccountActionAlignment: Story = {
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		queries: [
			{ key: userUIPreferences().queryKey, data: {} },
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

export const ScaledAccountActionAlignment: Story = {
	...AccountActionAlignment,
	args: { scale: 120 },
};

export const CompactDockWithoutPageAction: Story = {
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		queries: [
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

export const RemovingQuickLink: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: ForAdminWithQuickLinks.args,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Settings/ }));
		const body = within(canvasElement.ownerDocument.body);
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
			await within(canvasElement).findByRole("button", {
				name: "Remove Account",
			}),
		);
	},
};
