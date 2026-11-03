import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { getPreferredProxy } from "#/contexts/ProxyContext";
import * as chatStore from "#/modules/platform/chat/chatStore";
import {
	MockPrimaryWorkspaceProxy,
	MockProxyLatencies,
	MockUserMember,
	MockUserOwner,
} from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import type { AdminSettingsPermissions } from "./AdminSettings";
import { NavbarView } from "./NavbarView";

const proxyContextValue = {
	latenciesLoaded: true,
	proxyLatencies: MockProxyLatencies,
	proxy: getPreferredProxy([MockPrimaryWorkspaceProxy], undefined),
	proxies: [MockPrimaryWorkspaceProxy],
	isLoading: false,
	isFetched: true,
	setProxy: vi.fn(),
	clearProxy: vi.fn(),
	refetchProxyLatencies: () => new Date(),
};

const renderNavbar = (
	adminPermissions: AdminSettingsPermissions,
	user = MockUserOwner,
) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<NavbarView
					user={user}
					supportLinks={[]}
					onSignOut={vi.fn()}
					adminPermissions={adminPermissions}
					proxyContextValue={proxyContextValue}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	);

const menuButtons = () =>
	screen
		.getAllByRole("button")
		.filter((button) => button.getAttribute("aria-haspopup") === "menu");

describe("NavbarView", () => {
	beforeEach(() => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [],
			count: 0,
		});
		vi.spyOn(API, "getInboxNotifications").mockResolvedValue({
			notifications: [],
			unread_count: 0,
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it.each([
		["Settings", "menu", undefined],
		["Settings", "menuitem", "Account"],
		["Resources", "menuitem", "Workspaces"],
		["User menu", "menuitem", "Account"],
	])(
		"does not start arranging from the %s dropdown %s %s",
		async (trigger, role, name) => {
			const save = vi
				.spyOn(PlatformAPI, "setUserUIPreferences")
				.mockImplementation(async (settings) => settings);
			renderNavbar({ canViewHud: true, canEditDeployment: true });
			const user = userEvent.setup();
			await user.click(
				screen.getByRole("button", { name: new RegExp(trigger) }),
			);
			await user.pointer({
				target: await screen.findByRole(role, { name }),
				keys: "[MouseRight]",
			});
			await user.keyboard("{Escape}");
			expect(save).not.toHaveBeenCalled();
		},
	);

	it.each(["Settings", "Resources", "User menu", "navbar surface"])(
		"starts arranging from the top-level %s item",
		async (name) => {
			const save = vi
				.spyOn(PlatformAPI, "setUserUIPreferences")
				.mockImplementation(async (settings) => settings);
			renderNavbar({ canViewHud: true });
			const user = userEvent.setup();
			await user.pointer({
				target:
					name === "navbar surface"
						? screen.getByTestId("navbar-arrange")
						: screen.getByRole("button", { name: new RegExp(name) }),
				keys: "[MouseRight]",
			});
			await user.click(screen.getByRole("button", { name: "Done" }));
			await waitFor(() => expect(save).toHaveBeenCalledOnce());
		},
	);

	it("has no Controls button of its own: the Controls are in the latency menu", async () => {
		renderNavbar({ canViewHud: true, canViewAuditLog: true });
		const withControls = menuButtons().filter((button) =>
			button.textContent?.includes("Settings"),
		);
		const trigger = screen.getByTestId("navbar-latency-controls");
		expect(withControls).toEqual([trigger]);
		expect(screen.getByTestId("navbar-hud-latency")).toContainElement(trigger);
		fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
		const menu = await screen.findByTestId("navbar-latency-controls-menu");
		expect(
			within(menu).getByRole("menuitem", { name: "Audit logs" }),
		).toBeInTheDocument();
	});

	it("gives an auditor the Controls in the latency menu, without the HUD", async () => {
		renderNavbar({ canViewAuditLog: true }, MockUserMember);
		expect(screen.queryByTestId("navbar-hud-latency")).toBeNull();
		const trigger = screen.getByTestId("navbar-latency-controls");
		expect(trigger).toHaveTextContent("Settings");
		fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
		const menu = await screen.findByTestId("navbar-latency-controls-menu");
		expect(
			within(menu).getByRole("menuitem", { name: "Audit logs" }),
		).toBeInTheDocument();
		expect(
			within(menu).queryByRole("menuitem", { name: "Settings" }),
		).toBeNull();
	});

	it.each([
		{ role: "member", permissions: {}, mobile: true },
		{ role: "user admin", permissions: { canViewUsers: true }, mobile: false },
		{ role: "auditor", permissions: { canViewAuditLog: true }, mobile: false },
		{ role: "owner", permissions: { canEditDeployment: true }, mobile: true },
	])(
		"opens and closes Settings chat for a $role without a pinned shortcut",
		async ({ permissions, mobile }) => {
			const setOpen = vi.spyOn(chatStore, "setChatMenuOpen");
			vi.spyOn(chatStore, "useChatConnection").mockImplementation(() => {});
			renderNavbar(
				permissions,
				"canEditDeployment" in permissions ? MockUserOwner : MockUserMember,
			);
			const user = userEvent.setup();
			if (mobile) {
				await user.click(screen.getByRole("button", { name: "Open menu" }));
				await user.click(
					await screen.findByRole("menuitem", {
						name: "Settings",
					}),
				);
			} else {
				await user.click(screen.getByRole("button", { name: /Settings/ }));
			}
			if (mobile)
				await user.click(
					await screen.findByRole("menuitem", { name: "Controls" }),
				);
			await user.click(
				await screen.findByRole("menuitem", {
					name: mobile ? "Chat" : "Open quick chat",
				}),
			);
			expect(setOpen).toHaveBeenCalledWith(true);
			await user.click(
				screen.getByRole("button", { name: "Dismiss quick chat" }),
			);
			expect(setOpen).toHaveBeenLastCalledWith(false);
		},
	);

	it("lets a member restore chat from the Settings menu", async () => {
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (settings) => settings);
		vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
			chat_hidden: true,
		});
		renderNavbar({}, MockUserMember);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /Settings/ }));
		await user.click(await screen.findByRole("menuitem", { name: "Controls" }));
		await user.pointer({
			target: await screen.findByRole("menuitem", { name: "Chat" }),
			keys: "[MouseRight]",
		});
		await user.click(await screen.findByRole("menuitem", { name: "Show" }));
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({ chat_hidden: false }),
		);
	});

	it("puts the logo in the same tile as the user's avatar", () => {
		renderNavbar({});
		const toolbar = within(screen.getByTestId("navbar-arrange"));
		const logo = toolbar.getByTestId("navbar-logo");
		const userMenu = screen.getByRole("button", { name: "User menu" });
		// the same trigger round the same tile (an Avatar of size lg)
		expect(new Set(logo.classList)).toEqual(new Set(userMenu.classList));
		const tile = toolbar.getByTestId("navbar-logo-tile");
		const avatar = userMenu.firstElementChild as HTMLElement;
		// inset as an uploaded (or the default) avatar is: this user has none here
		const without = (el: HTMLElement) =>
			new Set([...el.classList].filter((c) => c !== "p-0.5"));
		expect(without(tile)).toEqual(without(avatar));
		expect(tile).toHaveClass("p-0.5");
	});
});
