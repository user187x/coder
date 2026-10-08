import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { reactRouterParameters } from "storybook-addon-remix-react-router";
import { AuthProvider } from "#/contexts/auth/AuthProvider";
import { DashboardContext } from "#/modules/dashboard/DashboardProvider";
import { AISettingsIndexRedirect } from "#/pages/AISettingsPage/AISettingsIndexRedirect";
import {
	MockAppearanceConfig,
	MockBuildInfo,
	MockDefaultOrganization,
	MockEntitlements,
	MockNoPermissions,
	MockPermissions,
	MockUserMember,
	MockUserOwner,
} from "#/testHelpers/entities";
import { pixelWithDesktop, pixelWithTablet } from "#/testHelpers/pixel";
import {
	withAuthProvider,
	withDashboardProvider,
} from "#/testHelpers/storybook";
import { adminPagesFor, resolveAdminQuickLinks } from "./adminQuickLinks";
import { NavbarView } from "./NavbarView";

const adminPages = adminPagesFor({
	permissions: MockPermissions,
	oauth2Provider: true,
	canViewAISettings: true,
});

const AISettingsIndexRedirectWithProviders = () => (
	<AuthProvider>
		<DashboardContext.Provider
			value={{
				entitlements: MockEntitlements,
				experiments: [],
				appearance: MockAppearanceConfig,
				buildInfo: MockBuildInfo,
				organizations: [MockDefaultOrganization],
				showOrganizations: false,
				canViewOrganizationSettings: false,
			}}
		>
			<AISettingsIndexRedirect />
		</DashboardContext.Provider>
	</AuthProvider>
);

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
			canViewDeployment: true,
			canViewOrganizations: true,
			canViewUsers: true,
			canViewAISettings: true,
			canViewAuditLog: true,
			canViewConnectionLog: true,
			canViewAIBridge: true,
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
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
	},
};

export const ForAdminWithCustomQuickLinks: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: {
		adminQuickLinks: {
			pages: adminPages,
			links: resolveAdminQuickLinks(["network", "health-database"], adminPages),
			isSaving: false,
			error: undefined,
			onSave: () => {},
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
	},
};

export const CustomizingQuickLinks: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: ForAdminWithCustomQuickLinks.args,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
		const [edit] = await within(canvasElement.ownerDocument.body).findAllByRole(
			"menuitem",
			{ name: "Customize this link" },
		);
		await userEvent.click(edit);
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
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
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
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
	},
};

export const ForTemplateUpdateOnlyAdmin: Story = {
	decorators: [withAuthProvider],
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		user: MockUserMember,
		permissions: {
			...MockNoPermissions,
			updateAnyTemplate: true,
		},
		reactRouter: reactRouterParameters({
			location: { path: "/" },
			routing: [
				{ path: "/", useStoryElement: true },
				{
					path: "/ai/settings",
					element: <AISettingsIndexRedirectWithProviders />,
				},
				{
					path: "/ai/settings/templates",
					element: <h1>Templates</h1>,
				},
			],
		}),
	},
	args: {
		user: MockUserMember,
		adminPermissions: {
			canViewUsers: true,
			canViewAISettings: true,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
		const body = within(canvasElement.ownerDocument.body);
		const aiSettingsLink = body.getByRole("menuitem", {
			name: "Super Intelligence",
		});
		await expect(aiSettingsLink).toHaveAttribute("href", "/ai/settings");
		await userEvent.click(aiSettingsLink);
		await expect(
			await canvas.findByRole("heading", { name: "Templates" }),
		).toBeInTheDocument();
	},
};

export const ForMCPUpdateOnlyAdmin: Story = {
	decorators: [withAuthProvider],
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		user: MockUserMember,
		permissions: {
			...MockNoPermissions,
			updateAnyMCPServerConfig: true,
		},
		reactRouter: reactRouterParameters({
			location: { path: "/" },
			routing: [
				{ path: "/", useStoryElement: true },
				{
					path: "/ai/settings",
					element: <AISettingsIndexRedirectWithProviders />,
				},
				{
					path: "/ai/settings/mcp-servers",
					element: <h1>MCP servers</h1>,
				},
			],
		}),
	},
	args: {
		user: MockUserMember,
		adminPermissions: {
			canViewUsers: true,
			canViewAISettings: true,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
		const body = within(canvasElement.ownerDocument.body);
		const aiSettingsLink = body.getByRole("menuitem", {
			name: "Super Intelligence",
		});
		await expect(aiSettingsLink).toHaveAttribute("href", "/ai/settings");
		await userEvent.click(aiSettingsLink);
		await expect(
			await canvas.findByRole("heading", { name: "MCP servers" }),
		).toBeInTheDocument();
	},
};

export const ForMCPDeleteOnlyAdmin: Story = {
	decorators: [withAuthProvider],
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		user: MockUserMember,
		permissions: {
			...MockNoPermissions,
			deleteAnyMCPServerConfig: true,
		},
		reactRouter: reactRouterParameters({
			location: { path: "/" },
			routing: [
				{ path: "/", useStoryElement: true },
				{
					path: "/ai/settings",
					element: <AISettingsIndexRedirectWithProviders />,
				},
				{
					path: "/ai/settings/mcp-servers",
					element: <h1>MCP servers</h1>,
				},
			],
		}),
	},
	args: {
		user: MockUserMember,
		adminPermissions: {
			canViewUsers: true,
			canViewAISettings: true,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			body.getByRole("menuitem", { name: "Super Intelligence" }),
		);
		await expect(
			await canvas.findByRole("heading", { name: "MCP servers" }),
		).toBeInTheDocument();
	},
};

export const ForMCPCreateOnlyAdmin: Story = {
	decorators: [withAuthProvider],
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		user: MockUserMember,
		permissions: {
			...MockNoPermissions,
			createAnyMCPServerConfig: true,
		},
		reactRouter: reactRouterParameters({
			location: { path: "/" },
			routing: [
				{ path: "/", useStoryElement: true },
				{
					path: "/ai/settings",
					element: <AISettingsIndexRedirectWithProviders />,
				},
				{
					path: "/ai/settings/mcp-servers/add",
					element: <h1>Add MCP server</h1>,
				},
			],
		}),
	},
	args: {
		user: MockUserMember,
		adminPermissions: {
			canViewUsers: true,
			canViewAISettings: true,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			body.getByRole("menuitem", { name: "Super Intelligence" }),
		);
		await expect(
			await canvas.findByRole("heading", { name: "Add MCP server" }),
		).toBeInTheDocument();
	},
};

export const ForSingleOrgOSSAdmin: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: {
		adminPermissions: {
			canViewDeployment: true,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Admin" }));
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
