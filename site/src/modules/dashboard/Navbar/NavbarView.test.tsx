import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
import { MockClusterUsage } from "#/testHelpers/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import type { AdminSettingsPermissions } from "./AdminSettings";
import { NavbarAction, NavbarActionTarget } from "./NavbarAction";
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
	path = "/",
) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter initialEntries={[path]}>
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

	it.each([true, false])(
		"keeps the root and Template breadcrumbs with Settings docked (compact: %s)",
		async (compact) => {
			vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
				admin_nav_in_navbar: true,
				settings_sidebar: true,
				settings_sidebar_compact: compact,
				settings_default_view: "/dashboard",
			});
			renderNavbar(
				{ canEditDeployment: true },
				MockUserOwner,
				"/templates/new/builder?step=base-parameters",
			);

			const start = within(screen.getByTestId("navbar-start"));
			expect(
				await start.findByRole("link", { name: "Dashboard" }),
			).toHaveAttribute("href", "/dashboard");
			expect(start.getByRole("button", { name: "Template" })).toBeVisible();
		},
	);

	it.each([
		["Settings", "menu", undefined],
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
				screen.getByRole("button", { name: new RegExp(`^${trigger}`) }),
			);
			await user.pointer({
				target: await screen.findByRole(role, { name }),
				keys: "[MouseRight]",
			});
			await user.keyboard("{Escape}");
			expect(save).not.toHaveBeenCalled();
		},
	);

	it.each(["Settings", "Resources", "User menu"])(
		"offers Configure on the top-level %s button",
		async (name) => {
			renderNavbar({ canViewHud: true });
			await userEvent.pointer({
				target: screen.getByRole("button", { name: new RegExp(`^${name}`) }),
				keys: "[MouseRight]",
			});
			await screen.findByRole("menuitem", { name: "Configure" });
		},
	);

	it("adds and moves a divider from the context menu and saves on outside click", async () => {
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (settings) => settings);
		renderNavbar({ canViewHud: true });
		const user = userEvent.setup();
		await user.pointer({
			target: screen.getByRole("button", { name: "Resources" }),
			keys: "[MouseRight]",
		});
		await user.click(
			await screen.findByRole("menuitem", { name: "Configure" }),
		);
		await user.click(screen.getByRole("button", { name: "Add divider" }));
		const divider = screen.getByRole("button", { name: "Move Divider 1" });
		divider.focus();
		await user.keyboard("{ArrowLeft}");
		expect(save).not.toHaveBeenCalled();

		await user.click(document.body);
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({
				navbar_layout: {
					order: expect.arrayContaining(["divider-1", "action"]),
					hidden: [],
				},
			}),
		);
		const layout = save.mock.calls[0]?.[0].navbar_layout;
		expect(layout?.order.at(-2)).toBe("divider-1");
		expect(layout?.order.at(-1)).toBe("action");
	});

	it.each([false, true])(
		"starts arranging on the backstrip (floating: %s)",
		async (floating) => {
			vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
				navbar_floating: floating,
			});
			const save = vi
				.spyOn(PlatformAPI, "setUserUIPreferences")
				.mockImplementation(async (settings) => settings);
			renderNavbar({ canViewHud: true });
			const user = userEvent.setup();
			await user.pointer({
				target: await screen.findByTestId(
					floating ? "navbar-resizable-group" : "navbar-arrange",
				),
				keys: "[MouseRight]",
			});
			screen.getByRole("button", { name: "Move Action" }).focus();
			await user.keyboard("{ArrowLeft}");
			await user.click(screen.getByRole("button", { name: "Done" }));
			await waitFor(() => expect(save).toHaveBeenCalledOnce());
		},
	);

	it("hides a portaled page action without entering rearrange mode", async () => {
		const order = [
			"logo",
			"banner",
			"action",
			"workspaces",
			"latency",
			"hud",
			"notifications",
			"account",
		];
		vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
			navbar_layout: { order, hidden: [] },
		});
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => changes);
		const onClick = vi.fn();
		const Page = () => {
			const [target, setTarget] = useState<HTMLDivElement | null>(null);
			return (
				<NavbarActionTarget.Provider value={target}>
					<QueryClientProvider client={new QueryClient()}>
						<MemoryRouter>
							<NavbarView
								actionRef={setTarget}
								user={MockUserOwner}
								supportLinks={[]}
								onSignOut={vi.fn()}
								adminPermissions={{ canViewHud: true }}
								proxyContextValue={proxyContextValue}
							/>
							<NavbarAction>
								<button type="button" onClick={onClick}>
									Create thing
								</button>
							</NavbarAction>
						</MemoryRouter>
					</QueryClientProvider>
				</NavbarActionTarget.Provider>
			);
		};
		renderComponent(<Page />);
		const user = userEvent.setup();
		await user.pointer({
			target: await screen.findByRole("button", { name: "Create thing" }),
			keys: "[MouseRight]",
		});
		expect(
			screen.queryByRole("button", { name: "Move Action" }),
		).not.toBeInTheDocument();
		await user.click(await screen.findByRole("menuitem", { name: "Hide" }));
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({
				navbar_layout: { order, hidden: ["action"] },
			}),
		);
		expect(onClick).not.toHaveBeenCalled();
	});

	it("opens admin controls from the Settings breadcrumb", async () => {
		renderNavbar({ canViewHud: true, canViewAuditLog: true });
		await userEvent.click(
			await screen.findByRole("button", { name: "Settings" }),
		);
		const menu = await screen.findByTestId("navbar-latency-controls-menu");
		expect(
			within(menu).getByRole("menuitem", { name: "Audit logs" }),
		).toBeInTheDocument();
	});

	it("gives an auditor admin controls without the HUD", async () => {
		renderNavbar({ canViewAuditLog: true }, MockUserMember);
		expect(screen.queryByTestId("navbar-hud-latency")).toBeNull();
		await userEvent.click(
			await screen.findByRole("button", { name: "Settings" }),
		);
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
				await user.click(screen.getByRole("button", { name: /^Settings/ }));
			}
			if (mobile)
				await user.click(
					within(
						await screen.findByRole("menuitem", { name: "Controls" }),
					).getByTitle("Controls"),
				);
			if (mobile)
				await user.click(await screen.findByRole("menuitem", { name: "Chat" }));
			else {
				// The Settings panel's bottom panel turns to its Chat face.
				const [toChat] = await screen.findAllByRole("button", {
					name: "Turn to Chat",
				});
				if (toChat) await user.click(toChat);
			}
			expect(setOpen).toHaveBeenCalledWith(true);
			await user.click(
				screen.getByRole("button", { name: "Dismiss quick chat" }),
			);
			expect(setOpen).toHaveBeenLastCalledWith(false);
		},
	);

	it("closes the workspace list for Controls chat and restores metrics when chat closes", async () => {
		vi.spyOn(chatStore, "useChatConnection").mockImplementation(() => {});
		vi.spyOn(PlatformAPI, "getClusterUsage").mockResolvedValue(
			MockClusterUsage,
		);
		renderNavbar({ canEditDeployment: true });
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Settings/ }));
		await user.click(
			within(
				await screen.findByRole("menuitem", { name: "Controls" }),
			).getByTitle("Controls"),
		);
		const pill = screen.getByTestId("workspaces-latency");
		pill.focus();
		await user.keyboard("{Enter}");
		expect(pill).toHaveAttribute("aria-expanded", "true");
		await user.click(screen.getByRole("menuitem", { name: "Chat" }));
		expect(pill).toHaveAttribute("aria-expanded", "false");
		const metrics = "Cluster CPU, memory, network and disk";
		expect(screen.queryByLabelText(metrics)).toBeNull();
		await user.click(
			screen.getByRole("button", { name: "Dismiss quick chat" }),
		);
		expect(await screen.findByLabelText(metrics)).toBeTruthy();
		expect(pill).toHaveAttribute("aria-expanded", "false");
	});

	it("opens Chat when the bottom panel is hidden and Controls is pinned", async () => {
		vi.spyOn(chatStore, "useChatConnection").mockImplementation(() => {});
		vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
			settings_face_hidden: true,
			settings_top_pinned: true,
		});
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => ({
				settings_top_pinned: true,
				...changes,
			}));
		renderNavbar({ canEditDeployment: true });
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Settings/ }));
		await user.click(
			within(
				await screen.findByRole("menuitem", { name: "Controls" }),
			).getByTitle("Controls"),
		);
		const chat = await screen.findByRole("menuitem", { name: "Chat" });
		await user.click(chat);
		expect(save).toHaveBeenCalledWith({ settings_face_hidden: null });
		await user.click(
			await screen.findByRole("button", { name: "Dismiss quick chat" }),
		);
		expect(chat).toHaveAttribute("aria-expanded", "false");
	});

	it("shows the Metrics face even if the former graph toggle was locked closed", async () => {
		vi.spyOn(PlatformAPI, "getClusterUsage").mockResolvedValue(
			MockClusterUsage,
		);
		vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
			settings_metrics: { expanded: false, locked: true },
		});
		renderNavbar({ canEditDeployment: true });
		await userEvent.click(screen.getByRole("button", { name: /^Settings/ }));
		await screen.findByRole("group", {
			name: "Cluster CPU, memory, network and disk",
		});
		expect(
			screen.queryByRole("menuitem", { name: "Show metric graphs" }),
		).toBeNull();
	});

	it("lets a member restore chat from the Settings menu", async () => {
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (settings) => settings);
		vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
			chat_hidden: true,
		});
		renderNavbar({}, MockUserMember);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Settings/ }));
		await user.click(
			within(
				await screen.findByRole("menuitem", { name: "Controls" }),
			).getByTitle("Controls"),
		);
		await user.pointer({
			target: await screen.findByRole("menuitem", { name: "Chat" }),
			keys: "[MouseRight]",
		});
		await user.click(await screen.findByRole("menuitem", { name: "Show" }));
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({
				chat_hidden: false,
				chat_position: null,
			}),
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
