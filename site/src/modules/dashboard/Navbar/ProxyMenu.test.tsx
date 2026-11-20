import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonitorIcon } from "lucide-react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter, useLocation } from "react-router";
import { API } from "#/api/api";
import { type HudHistory, PlatformAPI } from "#/api/platform";
import { coderHeartbeat, hudHistory } from "#/api/queries/platform";
import { getPreferredProxy } from "#/contexts/ProxyContext";
import * as animations from "#/hooks/useAnimationSettings";
import {
	MockPermissions,
	MockPrimaryWorkspaceProxy,
	MockProxyLatencies,
	MockUserAppearanceSettings,
	MockUserOwner,
	MockWorkspace,
	MockWorkspaceProxies,
} from "#/testHelpers/entities";
import { MockHudHistory } from "#/testHelpers/hud";
import { MockClusterUsage } from "#/testHelpers/platform";
import { renderComponent, renderWithAuth } from "#/testHelpers/renderHelpers";
import { adminPagesFor } from "./adminQuickLinks";
import { ProxyMenu } from "./ProxyMenu";
import { settingsMenuSlot } from "./settingsMenuHost";

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

const CurrentLocation = () => {
	const { pathname, search } = useLocation();
	return <output aria-label="Current route">{pathname + search}</output>;
};

const renderMenu = (
	props: Omit<React.ComponentProps<typeof ProxyMenu>, "user" | "onSignOut">,
	client = new QueryClient(),
) =>
	renderComponent(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<ProxyMenu {...props} user={MockUserOwner} onSignOut={vi.fn()} />
				<CurrentLocation />
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
			await user.click(screen.getByRole("button", { name: /^Settings/ }));
			const shortcut = await screen.findByRole("menuitem", {
				name: "Appearance",
			});
			await user.pointer({ target: shortcut, keys: "[MouseRight]" });
			await user.pointer({ target: shortcut, keys: "[MouseRight]" });
			await user.pointer({ target: shortcut, keys: "[MouseRight]" });
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
			await user.keyboard("{Shift>}{F10}{/Shift}");
			await user.keyboard("{Shift>}{F10}{/Shift}");
			await user.click(
				within(
					screen.getByRole("group", { name: "Personal dashboard appearance" }),
				).getByRole("menuitemcheckbox", { name: /Animations/ }),
			);
			expect(animate).toHaveBeenCalledWith(false);
		},
	);

	it.each([
		["Side Panel", true],
		["Breadcrumb", false],
	] as const)(
		"chooses %s from the compact Settings key",
		async (label, docked) => {
			const prefs = { settings_sidebar: true, settings_sidebar_compact: true };
			vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue(prefs);
			const save = vi
				.spyOn(PlatformAPI, "setUserUIPreferences")
				.mockImplementation(async (changes) => ({ ...prefs, ...changes }));
			const user = userEvent.setup();
			renderMenu({ proxyContextValue: value, hud: true, controls });
			const key = await screen.findByRole("menuitem", {
				name: "Expand Settings sidebar",
			});
			await user.pointer({ target: key, keys: "[MouseRight]" });
			const choices = await screen.findByRole("dialog", {
				name: "Settings layout",
			});
			expect(save).not.toHaveBeenCalled();
			await user.click(within(choices).getByRole("button", { name: label }));
			await waitFor(() =>
				expect(save).toHaveBeenCalledWith({
					settings_sidebar: docked,
					settings_sidebar_compact: false,
				}),
			);
		},
	);

	describe("compact metric history", () => {
		const start = 1_780_000_000;
		const timestamps = [start, start + 15, start + 30, start + 45];

		beforeEach(() => {
			vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
				settings_sidebar: true,
				settings_sidebar_compact: true,
			});
			vi.mocked(PlatformAPI.getClusterUsage).mockResolvedValue({
				...MockClusterUsage,
				history: {
					every: 15,
					points: timestamps.map((t, index) => ({
						t,
						cpu: index + 1,
						cpuTotal: 16,
						memory: (index + 12) * 1024 ** 3,
						memoryTotal: 64 * 1024 ** 3,
					})),
				},
				network: {
					every: 15,
					rx: 2000,
					tx: 1500,
					points: timestamps.map((t, index) => ({
						t,
						rx: 2000 + index * 500,
						tx: 1500 + index * 750,
					})),
				},
			});
		});

		const openGraph = async (name: string) => {
			const client = new QueryClient();
			const history: HudHistory = {
				...MockHudHistory,
				range: "15m",
				step: 15,
				points: timestamps.map((t, index) => ({
					...MockHudHistory.points[index],
					t,
				})),
			};
			vi.mocked(PlatformAPI.getHudHistory).mockResolvedValue(history);
			client.setQueryData(hudHistory("15m").queryKey, history);
			renderMenu({ proxyContextValue: value, hud: true, controls }, client);
			const graph = await screen.findByRole("menuitem", { name });
			await waitFor(() => expect(graph).not.toHaveAttribute("aria-disabled"));
			vi.spyOn(graph, "getBoundingClientRect").mockReturnValue(
				new DOMRect(0, 0, 36, 600),
			);
			return graph;
		};

		it.each([
			["Total CPU used", "cpu"],
			["Total memory used", "memory"],
			["Cluster network", "net"],
			["Total disk used", "disk"],
		])("opens the HUD at the clicked %s sample", async (name, metric) => {
			const graph = await openGraph(name);
			const user = userEvent.setup();
			await user.pointer({
				target: graph,
				coords: { clientX: 12, clientY: 575 },
				keys: "[MouseLeft]",
			});
			expect(
				screen.getByRole("status", { name: "Current route" }),
			).toHaveTextContent(`/hud?metric=${metric}&sample=${start + 15}`);
		});

		it("opens the dragged time range in a dialog", async () => {
			const graph = await openGraph("Cluster network");
			const user = userEvent.setup();
			await user.pointer([
				{
					target: graph,
					coords: { clientX: 12, clientY: 595 },
					keys: "[MouseLeft>]",
				},
				{ target: graph, coords: { clientX: 12, clientY: 575 } },
				{ keys: "[/MouseLeft]" },
			]);
			const dialog = await screen.findByRole("dialog", {
				name: "Cluster network",
			});
			const time = (t: number) => new Date(t * 1000).toLocaleString("en-US");
			expect(dialog).toHaveAccessibleDescription(
				`${time(start + 15)} to ${time(start + 45)}`,
			);
			await user.click(within(dialog).getByRole("button", { name: "Close" }));
			expect(
				screen.getByRole("status", { name: "Current route" }),
			).toHaveTextContent(/^\/$/);
		});
	});

	it("toggles live metric graphs without expanding the shortcut rail", async () => {
		const prefs = { settings_sidebar: true, settings_sidebar_compact: true };
		vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue(prefs);
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => ({ ...prefs, ...changes }));
		const user = userEvent.setup();
		renderMenu({ proxyContextValue: value, hud: true, controls });
		const graphs = await screen.findByRole("group", {
			name: "Cluster metric history",
		});
		expect(within(graphs).getAllByRole("img")).toHaveLength(4);
		fireEvent.contextMenu(
			screen.getByRole("menuitem", { name: "Hide metric graphs" }),
		);
		const hudShortcut = await screen.findByRole("menuitem", {
			name: "Show HUD",
		});
		expect(hudShortcut).toHaveAttribute("href", "/hud");
		expect(save).not.toHaveBeenCalled();
		await user.keyboard("{Escape}");
		await user.click(
			screen.getByRole("menuitem", { name: "Hide metric graphs" }),
		);
		expect(save).toHaveBeenCalledWith({
			settings_metrics: { expanded: false, locked: false },
		});
		expect(
			screen.queryByRole("group", { name: "Cluster metric history" }),
		).toBeNull();
		await user.click(
			screen.getByRole("menuitem", { name: "Show metric graphs" }),
		);
		expect(
			await screen.findByRole("group", { name: "Cluster metric history" }),
		).toBeVisible();
	});

	it("synchronizes the Metrics latency with the open HUD heartbeat", async () => {
		const probe = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("OK"));
		const client = new QueryClient();
		client.setQueryData(coderHeartbeat().queryKey, { latency: 4000 });
		renderMenu({ proxyContextValue: value, hud: true, controls }, client);
		const menu = await openMenu();
		const hud = within(menu).getByRole("menuitem", { name: "HUD" });
		expect(probe).not.toHaveBeenCalledWith("/healthz", expect.anything());
		fireEvent.contextMenu(hud);
		const heartbeat = within(menu).getByRole("group", {
			name: "HUD heartbeat",
		});
		await within(heartbeat).findByText("Latency decreased");
		const pill = await within(menu).findByTestId("navbar-latency-pill");
		for (const latency of [126, 98, 0]) {
			act(() => client.setQueryData(coderHeartbeat().queryKey, { latency }));
			await waitFor(() => {
				expect(heartbeat).toHaveTextContent(`${latency} ms`);
				expect(pill).toHaveTextContent(`${latency} ms`);
			});
		}
		expect(probe).toHaveBeenCalledWith(
			"/healthz",
			expect.objectContaining({ cache: "no-store" }),
		);
		expect(
			within(heartbeat).queryByRole("menuitem", { name: "Open" }),
		).toBeNull();
		fireEvent.contextMenu(hud);
		expect(
			within(menu).queryByRole("group", { name: "HUD heartbeat" }),
		).toBeNull();
		expect(pill).toHaveTextContent("Latency for");
		probe.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
		fireEvent.contextMenu(hud);
		await waitFor(() => expect(pill).toHaveTextContent("No response"));
		expect(
			within(menu).getByRole("group", { name: "HUD heartbeat" }),
		).toHaveTextContent("No response");
	});

	it("shows latency beside the cluster heading and keeps HUD and docking in navigation", async () => {
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => changes);
		renderMenu({ proxyContextValue: value, hud: true, controls });
		const split = screen.getByTestId("navbar-hud-latency");
		expect(within(split).queryByRole("link", { name: "HUD" })).toBeNull();
		const menu = await openMenu();
		const navigation = within(menu).getByRole("group", {
			name: "Settings navigation",
		});
		expect(
			within(navigation).getByRole("menuitem", { name: "HUD" }),
		).toHaveAttribute("href", "/hud");
		const docking = within(navigation).getByRole("group", { name: "Docking" });
		const dock = within(docking).getByRole("menuitem", {
			name: "Dock Settings",
		});
		expect(dock).toHaveTextContent("");

		const cluster = await within(menu).findByRole("group", {
			name: "Cluster CPU, memory, network and disk",
		});
		const pill = within(cluster).getByTestId("navbar-latency-pill");
		expect(within(navigation).queryByTestId("navbar-latency-pill")).toBeNull();
		const refreshes = value.refetchProxyLatencies.mock.calls.length;
		await userEvent.click(pill);
		expect(value.refetchProxyLatencies).toHaveBeenCalledTimes(refreshes + 1);
		expect(pill).toHaveTextContent(/Latency for.*ms/);

		await userEvent.click(dock);
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith(
				expect.objectContaining({ settings_sidebar: true }),
			),
		);
		const undock = await screen.findByRole("menuitem", {
			name: "Return to dropdown",
		});
		expect(undock).toBeVisible();
		expect(screen.queryByRole("button", { name: /^Settings/ })).toBeNull();
		await userEvent.click(undock);
		expect(
			await screen.findByRole("button", { name: /^Settings/ }),
		).toBeVisible();
		const compactDock = await screen.findByRole("menuitem", {
			name: "Dock Settings as shortcut icons",
		});
		await userEvent.click(compactDock);
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({
				settings_sidebar: true,
				settings_sidebar_compact: true,
			}),
		);
	});

	it("collapses the quick links while keeping the metrics face active", async () => {
		const user = userEvent.setup();
		renderMenu({ proxyContextValue: value, hud: true, controls });
		const menu = await openMenu();
		await user.click(
			within(menu).getByRole("menuitem", { name: "Collapse quick links" }),
		);
		expect(within(menu).queryByTestId("quick-links-scroll")).toBeNull();
		expect(
			within(menu).getByRole("region", { name: "Settings panel: Metrics" }),
		).toBeTruthy();

		await user.click(
			within(menu).getByRole("button", { name: "Turn to Cloud Drive" }),
		);
		expect(
			within(menu).getByRole("region", { name: "Settings panel: Cloud Drive" }),
		).toBeTruthy();
		await user.click(
			within(menu).getByRole("menuitem", { name: "Show quick links" }),
		);
		expect(within(menu).getByTestId("quick-links-scroll")).toBeTruthy();
	});

	it.each(["up", "down"] as const)(
		"switches between links, the selected face, and both in %s mode",
		async (direction) => {
			const user = userEvent.setup();
			vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
				settings_face_collapse_direction: direction,
			});
			renderMenu({ proxyContextValue: value, hud: true, controls });
			const menu = await openMenu();
			await user.click(
				within(menu).getByRole("button", { name: "Turn to Cloud Drive" }),
			);
			await user.click(
				within(menu).getByRole("button", { name: "Show only quick links" }),
			);
			expect(
				within(menu).queryByRole("group", { name: "Turn the panel" }),
			).toBeNull();
			await user.click(
				within(menu).getByRole("button", {
					name: "Show only the bottom panel",
				}),
			);
			expect(
				within(menu).queryByRole("navigation", { name: "Settings" }),
			).toBeNull();
			expect(
				within(menu).getByRole("region", {
					name: "Settings panel: Cloud Drive",
				}),
			).toBeTruthy();
			await user.click(
				within(menu).getByRole("button", { name: "Show both panels" }),
			);
			expect(
				within(menu).getByRole("navigation", { name: "Settings" }),
			).toBeTruthy();
			expect(
				within(menu).getByRole("region", {
					name: "Settings panel: Cloud Drive",
				}),
			).toBeTruthy();
		},
	);

	it("expands the top section from a double click on Controls and pins it open", async () => {
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => changes);
		renderMenu({ proxyContextValue: single, hud: true, controls });
		const menu = await openMenu();
		const bar = await within(menu).findByRole("menuitem", {
			name: "Controls",
		});
		fireEvent.doubleClick(bar);
		fireEvent.click(await within(menu).findByTitle(/Pin it open/));
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({ settings_top_pinned: true }),
		);
	});

	it("keeps Settings available without the HUD", () => {
		renderMenu({ proxyContextValue: value });
		expect(screen.queryByTestId("navbar-hud-latency")).toBeNull();
		expect(screen.queryByRole("link", { name: /HUD/ })).toBeNull();
		const button = screen.getByRole("button", { name: /^Settings/ });
		expect(button).toBeVisible();
		expect(button).toHaveTextContent("Settings");
	});

	it("holds the Workspaces row, then the whole Controls menu, its graphs last - no Default row", async () => {
		renderMenu({ proxyContextValue: single, hud: true, controls });
		const menu = await openMenu();
		const cluster = await within(menu).findByRole("group", {
			name: "Cluster CPU, memory, network and disk",
		});
		const list = within(menu).getByTestId("workspaces-latency-list");
		const navigation = within(menu).getByRole("group", {
			name: "Settings navigation",
		});
		const items = within(menu)
			.getAllByRole("menuitem")
			.filter(
				(item) =>
					!navigation.contains(item) &&
					!cluster.contains(item) &&
					!list.contains(item) &&
					item.textContent?.trim(),
			);
		expect(items.map((item) => item.textContent?.trim())).toEqual([
			expect.stringMatching(/^Workspaces/),
			...pages.slice(0, 2).map((page) => page.label),
			"Profile",
			"Organizations",
			"Audit logs",
			"Connection logs",
			"Controls",
		]);
		expect(items[0]).toBe(within(menu).getByTestId("workspaces-latency"));
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

	it("expands the current user's workspace links inside their pinned row", async () => {
		vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [{ ...MockWorkspace, owner_name: "test", name: "Browser" }],
			count: 1,
		});
		renderMenu({
			proxyContextValue: single,
			controls: {
				...controls,
				quickLinks: [
					{
						id: "workspaces",
						label: "Workspaces",
						path: "/workspaces",
						icon: MonitorIcon,
					},
				],
			},
		});
		const menu = await openMenu();
		const link = within(within(menu).getByTestId("controls-group")).getByRole(
			"menuitem",
			{ name: "Workspaces" },
		);
		fireEvent.contextMenu(link);
		const destinations = await within(menu).findByRole("group", {
			name: "Your workspaces",
		});
		expect(link.parentElement).toContainElement(destinations);
		expect(
			await within(destinations).findByRole("menuitem", { name: "Browser" }),
		).toHaveAttribute("href", "/@test/Browser");
		fireEvent.contextMenu(link);
		expect(
			within(menu).queryByRole("group", { name: "Your workspaces" }),
		).toBeNull();
	});

	it.each([
		["Settings", undefined],
		["Storage", "/deployment/storage"],
	])(
		"opens Settings from the root chevron with %s as home",
		async (_home, path) => {
			vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
				admin_nav_in_navbar: true,
				settings_default_view: path,
			});
			const user = userEvent.setup();
			const slot = document.createElement("li");
			const navbarStart = document.createElement("ul");
			navbarStart.className = "navbar-start";
			navbarStart.append(slot);
			document.body.append(navbarStart);
			renderWithAuth(
				<ProxyMenu
					proxyContextValue={value}
					controls={{ ...controls, categories: pages }}
					user={MockUserOwner}
					onSignOut={vi.fn()}
				/>,
			);
			let leave: (() => void) | undefined;
			act(() => {
				leave = settingsMenuSlot(slot);
			});
			const trigger = await within(slot).findByRole("button", {
				name: "Settings",
			});
			await user.click(trigger);
			const menu = await screen.findByTestId("navbar-latency-controls-menu");
			expect(menu.dataset.settingsEdge).toBe("left");
			// every category not already a quick link, each hideable under Controls
			const category = pages.slice(2).find((page) => page.id !== "chat");
			if (!category) throw new Error("no admin page past the quick links");
			expect(
				within(menu).getByRole("menuitem", {
					name: `Hide ${category.label} under Controls`,
				}),
			).toBeTruthy();
			await user.click(trigger);
			await waitFor(() =>
				expect(screen.queryByTestId("navbar-latency-controls-menu")).toBeNull(),
			);
			const save = vi
				.spyOn(PlatformAPI, "setUserUIPreferences")
				.mockResolvedValue({
					settings_sidebar: true,
					settings_sidebar_compact: true,
				});
			await user.pointer({ target: trigger, keys: "[MouseRight]" });
			await user.click(
				await screen.findByRole("menuitem", { name: "Side Strip" }),
			);
			expect(save).toHaveBeenCalledWith({
				settings_sidebar: true,
				settings_sidebar_compact: true,
			});
			act(() => leave?.());
			navbarStart.remove();
		},
	);
});
