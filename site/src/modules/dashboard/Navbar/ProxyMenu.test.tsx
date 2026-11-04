import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { getPreferredProxy } from "#/contexts/ProxyContext";
import * as animations from "#/hooks/useAnimationSettings";
import {
	MockPermissions,
	MockPrimaryWorkspaceProxy,
	MockProxyLatencies,
	MockUserAppearanceSettings,
	MockUserOwner,
	MockWorkspaceProxies,
} from "#/testHelpers/entities";
import { MockHudHistory } from "#/testHelpers/hud";
import { MockClusterUsage } from "#/testHelpers/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { adminPagesFor } from "./adminQuickLinks";
import { ProxyMenu } from "./ProxyMenu";

const value = {
	latenciesLoaded: true,
	proxyLatencies: MockProxyLatencies,
	proxy: getPreferredProxy(MockWorkspaceProxies, undefined),
	proxies: MockWorkspaceProxies,
	isLoading: false,
	isFetched: true,
	setProxy: vi.fn(),
	clearProxy: vi.fn(),
	refetchProxyLatencies: vi.fn(() => new Date()),
};

// The primary region alone: what the menu's "Default" row showed.
const single = {
	...value,
	proxies: [MockPrimaryWorkspaceProxy],
	proxy: getPreferredProxy([MockPrimaryWorkspaceProxy], undefined),
};

const pages = adminPagesFor({
	permissions: MockPermissions,
	oauth2Provider: true,
});

const controls = {
	permissions: {
		canViewHud: true,
		canViewOrganizations: true,
		canViewAuditLog: true,
		canViewConnectionLog: true,
	},
	quickLinks: pages.slice(0, 2),
};

const renderMenu = (
	props: Omit<
		React.ComponentProps<typeof ProxyMenu>,
		"user" | "supportLinks" | "onSignOut"
	>,
) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<ProxyMenu
					{...props}
					user={MockUserOwner}
					supportLinks={[]}
					onSignOut={vi.fn()}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	);

const openMenu = async () => {
	fireEvent.pointerDown(screen.getByTestId("navbar-latency-controls"), {
		button: 0,
		ctrlKey: false,
	});
	return screen.findByTestId("navbar-latency-controls-menu");
};

describe("ProxyMenu", () => {
	beforeEach(() => {
		vi.spyOn(API, "getInboxNotifications").mockResolvedValue({
			notifications: [],
			unread_count: 0,
		});
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		vi.spyOn(PlatformAPI, "getHudHistory").mockResolvedValue(MockHudHistory);
		vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [],
			count: 0,
		});
		vi.spyOn(PlatformAPI, "getClusterUsage").mockResolvedValue(
			MockClusterUsage,
		);
	});
	afterEach(() => vi.restoreAllMocks());

	it.each([false, true])(
		"changes personal appearance inline (editable links: %s)",
		async (editable) => {
			vi.spyOn(API, "getAppearanceSettings").mockResolvedValue(
				MockUserAppearanceSettings,
			);
			const update = vi
				.spyOn(API, "updateAppearanceSettings")
				.mockResolvedValue({
					...MockUserAppearanceSettings,
					theme_preference: "light",
				});
			const animate = vi
				.spyOn(animations, "setAnimationsEnabled")
				.mockImplementation(() => {});
			const user = userEvent.setup();
			renderMenu({
				proxyContextValue: value,
				controls: {
					...controls,
					quickLinks: pages.filter((page) => page.id === "customize"),
					quickLinksEditor: editable
						? { addable: [], onChange: vi.fn() }
						: undefined,
				},
			});
			await user.click(screen.getByRole("button", { name: /Settings/ }));
			const shortcut = await screen.findByRole("menuitem", {
				name: "Appearance",
			});
			await user.click(shortcut);
			await user.click(shortcut);
			await user.click(shortcut);
			const appearance = within(
				await screen.findByRole("group", {
					name: "Personal dashboard appearance",
				}),
			);
			await user.click(
				appearance.getByRole("menuitemcheckbox", { name: "Dark Mode" }),
			);
			await waitFor(() =>
				expect(update).toHaveBeenCalledWith(
					expect.objectContaining({
						theme_preference: "light",
						theme_mode: "single",
					}),
				),
			);
			shortcut.focus();
			await user.keyboard("{Enter}");
			await user.keyboard("{Enter}");
			await user.click(
				within(
					screen.getByRole("group", { name: "Personal dashboard appearance" }),
				).getByRole("menuitemcheckbox", { name: /Animations/ }),
			);
			expect(animate).toHaveBeenCalledWith(false);
		},
	);

	it("joins the HUD on as one split button: the HUD's link, then the latency in a pill, Controls and the chevron", () => {
		renderMenu({ proxyContextValue: value, hud: true, controls });
		const split = screen.getByTestId("navbar-hud-latency");
		const [hud, menu] = Array.from(split.children);
		expect(hud).toHaveAttribute("href", "/hud");
		expect(hud).toHaveTextContent("HUD");
		expect(menu.tagName).toBe("BUTTON");
		expect(menu).toHaveAttribute("aria-haspopup", "menu");
		const pill = within(menu as HTMLElement).getByTestId("navbar-latency-pill");
		expect(menu.firstElementChild).toBe(pill);
		expect(pill).toHaveClass("rounded-full");
		// the latency reading, its antenna in the latency's colour (green: good)
		expect(pill).toHaveTextContent(/Latency for/);
		expect(pill).toHaveTextContent(/ms/);
		expect(pill.querySelector("svg")).toHaveClass("text-content-success");
		// "Settings" to the pill's right
		expect(pill.nextSibling?.textContent).toBe("Settings");
	});

	it("keeps Settings available without the HUD", () => {
		renderMenu({ proxyContextValue: value });
		expect(screen.queryByTestId("navbar-hud-latency")).toBeNull();
		expect(screen.queryByRole("link", { name: /HUD/ })).toBeNull();
		const button = screen.getByRole("button", { name: /Latency for/ });
		expect(button).toBeVisible();
		expect(button).toHaveTextContent("Settings");
	});

	it("holds the Workspaces row, then the whole Controls menu, its graphs last - no Default row", async () => {
		renderMenu({ proxyContextValue: single, hud: true, controls });
		const menu = await openMenu();
		await within(menu).findByRole("group", {
			name: "Cluster CPU, memory, network and disk",
		});
		const list = within(menu).getByTestId("workspaces-latency-list");
		const tray = within(menu).getByRole("group", {
			name: "Resource shortcuts",
		});
		const items = within(menu)
			.getAllByRole("menuitem")
			.filter(
				(item) =>
					!list.contains(item) &&
					!tray.contains(item) &&
					item.textContent?.trim(),
			);
		expect(items.map((item) => item.textContent?.trim())).toEqual([
			"Dock Settings",
			expect.stringMatching(/^Workspaces/),
			...pages.slice(0, 2).map((page) => page.label),
			"Controls",
			"Organizations",
			"Audit logs",
			"Connection logs",
		]);
		expect(items[1]).toBe(within(menu).getByTestId("workspaces-latency"));
		// the old first row (the region, its latency and its house) and the refresh row are gone
		expect(within(menu).queryByRole("menuitemradio")).toBeNull();
		expect(
			within(menu).queryByText(MockPrimaryWorkspaceProxy.display_name),
		).toBeNull();
		expect(within(menu).queryByText("Refresh latencies")).toBeNull();
		expect(within(menu).queryByTestId("navbar-region")).toBeNull();
	});

	it("measures the latency again each time it opens", async () => {
		const refetch = vi.fn(() => new Date());
		renderMenu({
			proxyContextValue: { ...single, refetchProxyLatencies: refetch },
		});
		await openMenu();
		expect(refetch).toHaveBeenCalledTimes(1);
	});

	it("offers the regions in a Region row's submenu when there is more than one", async () => {
		const setProxy = vi.fn();
		renderMenu({ proxyContextValue: { ...value, setProxy }, controls });
		const menu = await openMenu();
		const region = within(menu).getByTestId("navbar-region");
		expect(screen.queryByRole("menuitemradio")).toBeNull();
		fireEvent.keyDown(region, { key: "ArrowRight" });
		const healthy = await screen.findByRole("menuitemradio", {
			name: /No wildcard/,
		});
		expect(screen.getAllByRole("menuitemradio")).toHaveLength(
			MockWorkspaceProxies.length,
		);
		fireEvent.click(healthy);
		expect(setProxy).toHaveBeenCalledWith(
			expect.objectContaining({ display_name: "No wildcard" }),
		);
	});

	it("keeps the Controls when the latency cannot be had", async () => {
		renderMenu({
			proxyContextValue: { ...value, error: new Error("404") },
			hud: true,
			controls,
		});
		const trigger = screen.getByTestId("navbar-latency-controls");
		expect(screen.queryByTestId("navbar-latency-pill")).toBeNull();
		await waitFor(() => expect(trigger).toHaveTextContent(/^Settings$/));
		const menu = await openMenu();
		await waitFor(() =>
			expect(
				within(menu).getByRole("menuitem", { name: "Accounts" }),
			).toBeInTheDocument(),
		);
	});
});
