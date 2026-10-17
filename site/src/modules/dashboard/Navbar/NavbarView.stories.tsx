import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
	MockBuildInfo,
	MockPermissions,
	MockUserMember,
	MockUserOwner,
} from "#/testHelpers/entities";
import { pixelWithDesktop, pixelWithTablet } from "#/testHelpers/pixel";
import { withDashboardProvider } from "#/testHelpers/storybook";
import { adminPagesFor, resolveAdminQuickLinks } from "./adminQuickLinks";
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
			canViewDeployment: true,
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
		await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
	},
};

export const ForAdminWithoutQuickLinks: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: {
		adminQuickLinks: { pages: adminPages, links: [], onChange: fn() },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
		const body = within(canvasElement.ownerDocument.body);
		await expect(
			await body.findByRole("menuitem", { name: "Add a quick link" }),
		).toBeInTheDocument();
		expect(body.queryByTestId("admin-quick-link")).toBeNull();
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
		await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
		const body = within(canvasElement.ownerDocument.body);
		await expect(await body.findAllByTestId("admin-quick-link")).toHaveLength(
			3,
		);
	},
};

export const RemovingQuickLink: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: ForAdminWithQuickLinks.args,
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			await body.findByRole("menuitem", {
				name: "Remove Health from the quick links",
			}),
		);
		await expect(args.adminQuickLinks?.onChange).toHaveBeenCalledWith([
			"announcement",
			"monitoring",
		]);
	},
};

export const AddingQuickLink: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: ForAdminWithQuickLinks.args,
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "Add a quick link" }),
		);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "Security" }),
		);
		await expect(args.adminQuickLinks?.onChange).toHaveBeenCalledWith([
			"announcement",
			"health",
			"monitoring",
			"security",
		]);
	},
};

export const ReorderingQuickLinkWithKeyboard: Story = {
	parameters: { pixel: { matrix: pixelWithDesktop } },
	args: ForAdminWithQuickLinks.args,
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
		const body = within(canvasElement.ownerDocument.body);
		(await body.findByRole("menuitem", { name: "Reorder Monitoring" })).focus();
		await userEvent.keyboard("{Enter}{ArrowUp}");
		await expect(args.adminQuickLinks?.onChange).toHaveBeenCalledWith([
			"announcement",
			"monitoring",
			"health",
		]);
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
		await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
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
		await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
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
		await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
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
