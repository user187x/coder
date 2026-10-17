import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, within } from "storybook/test";
import { MockBuildInfo, MockUserOwner } from "#/testHelpers/entities";
import { withDashboardProvider } from "#/testHelpers/storybook";
import { UserDropdown } from "./UserDropdown";

const meta: Meta<typeof UserDropdown> = {
	title: "modules/dashboard/UserDropdown",
	component: UserDropdown,
	args: {
		user: MockUserOwner,
		buildInfo: MockBuildInfo,
		supportLinks: [
			{ icon: "docs", name: "Documentation", target: "" },
			{ icon: "bug", name: "Report a bug", target: "" },
			{ icon: "chat", name: "Join the Coder Discord", target: "" },
			{ icon: "star", name: "Star the Repo", target: "" },
			{ icon: "/icon/aws.svg", name: "Amazon Web Services", target: "" },
		],
	},
	decorators: [withDashboardProvider],
};

export default meta;
type Story = StoryObj<typeof UserDropdown>;

const openDropdown = async (canvasElement: HTMLElement) => {
	const canvas = within(canvasElement);
	await userEvent.click(canvas.getByRole("button"));
	return within(
		await within(canvasElement.ownerDocument.body).findByRole("menu"),
	);
};

// Overrides platform detection so the Coder Desktop gating can be exercised in
// a story. Returns a cleanup that restores the spied getters.
const mockPlatform = (platform: string, maxTouchPoints = 0) => {
	const platformSpy = spyOn(navigator, "platform", "get").mockReturnValue(
		platform,
	);
	const touchSpy = spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(
		maxTouchPoints,
	);
	return () => {
		platformSpy.mockRestore();
		touchSpy.mockRestore();
	};
};

const Example: Story = {};

export const InstallCoderDesktopMacOS: Story = {
	beforeEach: () => mockPlatform("MacIntel"),
	play: async ({ canvasElement, step }) => {
		await step(
			"links Install Coder Desktop to the docs alongside Install CLI",
			async () => {
				const menu = await openDropdown(canvasElement);
				expect(
					menu.getByRole("menuitem", { name: "Install Coder Desktop" }),
				).toHaveAttribute("href", "https://coder.com/docs/user-guides/desktop");
				expect(
					menu.getByRole("menuitem", { name: "Install CLI" }),
				).toBeInTheDocument();
			},
		);
	},
};

export const InstallCoderDesktopWindows: Story = {
	beforeEach: () => mockPlatform("Win32"),
	play: async ({ canvasElement, step }) => {
		await step("shows Install Coder Desktop on Windows", async () => {
			const menu = await openDropdown(canvasElement);
			expect(
				menu.getByRole("menuitem", { name: "Install Coder Desktop" }),
			).toBeInTheDocument();
		});
	},
};

export const InstallCoderDesktopHiddenOnLinux: Story = {
	beforeEach: () => mockPlatform("Linux x86_64"),
	play: async ({ canvasElement, step }) => {
		await step(
			"hides Install Coder Desktop but keeps Install CLI",
			async () => {
				const menu = await openDropdown(canvasElement);
				expect(
					menu.queryByRole("menuitem", { name: "Install Coder Desktop" }),
				).not.toBeInTheDocument();
				expect(
					menu.getByRole("menuitem", { name: "Install CLI" }),
				).toBeInTheDocument();
			},
		);
	},
};

export const InstallCoderDesktopHiddenOniPadOS: Story = {
	// iPadOS 13+ reports "MacIntel" but exposes a touchscreen.
	beforeEach: () => mockPlatform("MacIntel", 5),
	play: async ({ canvasElement, step }) => {
		await step("hides Install Coder Desktop on iPadOS", async () => {
			const menu = await openDropdown(canvasElement);
			expect(
				menu.queryByRole("menuitem", { name: "Install Coder Desktop" }),
			).not.toBeInTheDocument();
		});
	},
};

export { Example as UserDropdown };
