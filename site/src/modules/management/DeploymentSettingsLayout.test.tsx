import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { Link, Outlet } from "react-router";
import { type Banner, PlatformAPI } from "#/api/platform";
import {
	NavbarAction,
	NavbarActionTarget,
	NavbarStartTarget,
} from "#/modules/dashboard/Navbar/NavbarAction";
import { AnnouncementBanner } from "#/modules/platform/announcement/AnnouncementBanner";
import { MockBanner } from "#/testHelpers/platform";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import DeploymentSettingsLayout from "./DeploymentSettingsLayout";

it("opens and closes the category menu without resetting the current page", async () => {
	const user = userEvent.setup();
	renderWithAuth(<DeploymentSettingsLayout />, {
		path: "/deployment",
		route: "/deployment/customize",
		children: [
			{ path: "customize", element: <input aria-label="Appearance search" /> },
		],
	});
	const search = await screen.findByRole("textbox", {
		name: "Appearance search",
	});
	await user.type(search, "demo");
	const category = screen.getByRole("button", { name: "Appearance" });
	await user.click(category);
	await screen.findByRole("link", { name: "Accounts" });
	await user.keyboard("{Escape}");
	await waitFor(() =>
		expect(screen.queryByRole("link", { name: "Accounts" })).toBeNull(),
	);
	expect(search).toHaveValue("demo");
});

describe("section introductions", () => {
	class SilentWebSocket {
		close() {}
	}

	const renderSections = (
		introductions: boolean,
		look: Partial<Banner> = {},
	) => {
		server.use(
			http.get("/__banner/banner.json", () =>
				HttpResponse.json({ ...MockBanner, introductions, ...look }),
			),
		);
		return renderWithAuth(<DeploymentSettingsLayout />, {
			path: "/deployment",
			route: "/deployment/users",
			children: [
				{
					element: (
						<>
							<AnnouncementBanner placement="navbar" />
							<Outlet />
						</>
					),
					children: [
						{
							path: "users",
							element: <Link to="/deployment/customize?tab=1">Go</Link>,
						},
						{
							path: "customize",
							element: <Link to="/deployment/customize?tab=2">Stay</Link>,
						},
					],
				},
			],
		});
	};

	beforeEach(() => {
		localStorage.clear();
		vi.stubGlobal("WebSocket", SilentWebSocket);
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("names the new section for 2 seconds, once per change of section", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderSections(true);
		const splash = await screen.findByTestId("section-splash");
		expect(splash).toHaveTextContent("");
		await user.click(await screen.findByRole("link", { name: "Go" }));
		await waitFor(() => expect(splash).toHaveTextContent("Appearance"));
		await act(() => vi.advanceTimersByTimeAsync(1900));
		expect(splash).toHaveTextContent("Appearance");
		await act(() => vi.advanceTimersByTimeAsync(200));
		expect(splash).toHaveTextContent("");
		// Same section, new query string: no splash.
		await user.click(screen.getByRole("link", { name: "Stay" }));
		expect(splash).toHaveTextContent("");
	});

	it("keeps the splash for the configured duration", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderSections(true, { introDurationMs: 6000 });
		const splash = await screen.findByTestId("section-splash");
		await user.click(await screen.findByRole("link", { name: "Go" }));
		await waitFor(() => expect(splash).toHaveTextContent("Appearance"));
		await act(() => vi.advanceTimersByTimeAsync(5800));
		expect(splash).toHaveTextContent("Appearance");
		await act(() => vi.advanceTimersByTimeAsync(400));
		expect(splash).toHaveTextContent("");
	});

	it("renders the splash with the chosen effect, size and weight", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderSections(true, {
			introEffect: "pewpew",
			introSize: "xlarge",
			introWeight: "black",
		});
		const splash = await screen.findByTestId("section-splash");
		await user.click(await screen.findByRole("link", { name: "Go" }));
		await waitFor(() => expect(splash).toHaveTextContent("Appearance"));
		expect(within(splash).getByTestId("section-splash-pill")).toHaveAttribute(
			"data-intro-effect",
			"pewpew",
		);
	});

	it("names the section when the page mounts a settings layout of its own", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		server.use(
			http.get("/__banner/banner.json", () =>
				HttpResponse.json({ ...MockBanner, introductions: true }),
			),
		);
		renderWithAuth(
			<>
				<AnnouncementBanner placement="navbar" />
				<Outlet />
			</>,
			{
				path: "/",
				route: "/deployment/users",
				children: [
					{
						path: "deployment",
						element: <DeploymentSettingsLayout />,
						children: [
							{
								path: "users",
								element: <Link to="/templates">Open the list</Link>,
							},
						],
					},
					{
						// As in the router: a level deeper than the deployment pages, so its layout is a new one.
						path: "templates",
						children: [
							{
								element: <DeploymentSettingsLayout />,
								children: [{ index: true, element: <h1>Templates list</h1> }],
							},
						],
					},
				],
			},
		);
		const splash = await screen.findByTestId("section-splash");
		await user.click(
			await screen.findByRole("link", { name: "Open the list" }),
		);
		await screen.findByRole("heading", { name: "Templates list" });
		await waitFor(() => expect(splash).toHaveTextContent("Templates"));
	});

	it("shows no splash when the setting is off", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderSections(false);
		await screen.findByText("Scheduled maintenance:", { exact: false });
		await user.click(await screen.findByRole("link", { name: "Go" }));
		await screen.findByRole("link", { name: "Stay" });
		expect(screen.queryByTestId("section-splash")).toBeNull();
	});
});

describe("Default View", () => {
	it("sets a category as the page Settings opens on, from its right-click menu", async () => {
		const user = userEvent.setup();
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => changes);
		renderWithAuth(<DeploymentSettingsLayout />, {
			path: "/deployment",
			route: "/deployment/customize",
			children: [{ path: "customize", element: <p>Appearance page</p> }],
		});
		await user.click(await screen.findByRole("button", { name: "Appearance" }));
		const link = await screen.findByRole("link", { name: "Accounts" });
		fireEvent.contextMenu(link);
		await user.click(
			await screen.findByRole("menuitemcheckbox", { name: "Default View" }),
		);
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({
				settings_default_view: "/deployment/users",
			}),
		);
	});

	it("sets the category root as the default from a breadcrumb on a subpage", async () => {
		const user = userEvent.setup();
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => changes);
		const { router } = renderWithAuth(<DeploymentSettingsLayout />, {
			path: "/deployment",
			route: "/deployment/users/create",
			children: [{ path: "users/create", element: <p>New account page</p> }],
		});
		fireEvent.contextMenu(
			await screen.findByRole("button", { name: "Accounts" }),
		);
		await user.click(
			await screen.findByRole("menuitem", { name: "Set Default" }),
		);
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({
				settings_default_view: "/deployment/users",
			}),
		);
		expect(router.state.location.pathname).toBe("/deployment/users/create");
	});

	it("opens Settings on the user's Default View", async () => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
			settings_default_view: "/deployment/appearance",
		});
		renderWithAuth(<DeploymentSettingsLayout />, {
			path: "/deployment",
			route: "/deployment",
			children: [
				{ path: "appearance", element: <p>Appearance page</p> },
				{ path: "users", element: <p>Accounts page</p> },
			],
		});
		expect(await screen.findByText("Appearance page")).toBeInTheDocument();
	});

	it("rings the default view's category and says so on hover", async () => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
			settings_default_view: "/deployment/users",
		});
		renderWithAuth(<DeploymentSettingsLayout />, {
			path: "/deployment",
			route: "/deployment/customize",
			children: [{ path: "customize", element: <p>Appearance page</p> }],
		});
		await userEvent.click(
			await screen.findByRole("button", { name: "Appearance" }),
		);
		const pill = await screen.findByTitle("Set as default view");
		expect(
			within(pill).getByRole("link", { name: "Accounts" }),
		).toHaveAttribute("href", "/deployment/users");
	});
});

it("keeps the page action and categories in the navbar with an old Beside Page preference", async () => {
	const user = userEvent.setup();
	const onCreate = vi.fn();
	const read = vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_nav_in_navbar: false,
	});
	const WithNavbarStart = () => {
		const [start, setStart] = useState<HTMLDivElement | null>(null);
		const [action, setAction] = useState<HTMLDivElement | null>(null);
		return (
			<NavbarActionTarget.Provider value={action}>
				<NavbarStartTarget.Provider value={start}>
					<nav aria-label="Top bar">
						<div ref={setStart} />
						<div ref={setAction} />
					</nav>
					<DeploymentSettingsLayout />
				</NavbarStartTarget.Provider>
			</NavbarActionTarget.Provider>
		);
	};
	renderWithAuth(<WithNavbarStart />, {
		path: "/deployment",
		route: "/deployment/users",
		children: [
			{
				path: "users",
				element: (
					<NavbarAction>
						<button type="button" onClick={onCreate}>
							New account
						</button>
					</NavbarAction>
				),
			},
		],
	});
	// In the navbar, the page no longer lists the categories beside itself.
	const breadcrumb = await waitFor(() => {
		expect(screen.queryByRole("link", { name: "Accounts" })).toBeNull();
		return screen.getByRole("navigation", { name: "breadcrumb" });
	});
	const topBar = screen.getByRole("navigation", { name: "Top bar" });
	await user.click(
		await within(topBar).findByRole("button", { name: "New account" }),
	);
	expect(
		within(breadcrumb).queryByRole("button", { name: "New account" }),
	).toBeNull();
	expect(onCreate).toHaveBeenCalledOnce();
	const category = within(breadcrumb).getByRole("button", { name: "Accounts" });
	category.focus();
	await user.keyboard("{Enter}");
	expect(
		await screen.findByRole("menuitem", { name: "New account" }),
	).toHaveAttribute("href", "/deployment/users/create");
	await user.keyboard("{Escape}");
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (changes) => {
			const prefs = { admin_nav_in_navbar: false, ...changes };
			read.mockResolvedValue(prefs);
			return prefs;
		});
	const root = within(breadcrumb).getByRole("link", { name: "Home" });
	await user.pointer({ target: root, keys: "[MouseRight]" });
	await user.click(await screen.findByRole("menuitem", { name: "Right Side" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({ navbar_settings_side: "right" }),
	);

	await user.pointer({ target: root, keys: "[MouseRight]" });
	const left = await screen.findByRole("menuitem", { name: "Left Side" });
	await waitFor(() =>
		expect(left).not.toHaveAttribute("aria-disabled", "true"),
	);
	await user.click(left);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({ navbar_settings_side: "left" }),
	);

	for (const [label, docked, compact, target] of [
		["Side Strip", true, true, root],
		["Side Panel", true, false, category],
		["Breadcrumb", false, false, category],
	] as const) {
		await user.pointer({ target, keys: "[MouseRight]" });
		await user.click(await screen.findByRole("menuitem", { name: label }));
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({
				settings_sidebar: docked,
				settings_sidebar_compact: compact,
			}),
		);
	}
});
