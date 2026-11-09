import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityIcon, LayoutTemplateIcon } from "lucide-react";
import { QueryClient, QueryClientProvider } from "react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { userUIPreferences } from "#/api/queries/platform";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import {
	MockUserAppearanceSettings,
	MockUserOwner,
} from "#/testHelpers/entities";
import { render, renderComponent } from "#/testHelpers/renderHelpers";
import { SettingsResourceTray } from "./SettingsResourceTray";

beforeEach(() =>
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({}),
);
afterEach(() => vi.restoreAllMocks());

it.each([
	["Dashboard", "/dashboard"],
	["Workspaces", "/workspaces"],
	["Templates", "/templates"],
])("opens %s from the keyboard-accessible tray", async (label, path) => {
	const user = userEvent.setup();
	const router = createMemoryRouter([
		{
			path: "*",
			element: (
				<DropdownMenu defaultOpen>
					<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
					<DropdownMenuContent>
						<SettingsResourceTray
							images
							user={MockUserOwner}
							supportLinks={[]}
							onSignOut={vi.fn()}
							pages={[
								{
									id: "templates",
									label: "Templates",
									path: "/templates",
									icon: LayoutTemplateIcon,
								},
							]}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	]);
	renderComponent(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	await user.click(screen.getByRole("menuitem", { name: label }));
	expect(router.state.location.pathname + router.state.location.hash).toBe(
		path,
	);
});

it("allows hiding and reopening the tray without navigating", async () => {
	const user = userEvent.setup();
	const router = createMemoryRouter([
		{
			path: "*",
			element: (
				<DropdownMenu defaultOpen>
					<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
					<DropdownMenuContent>
						<SettingsResourceTray
							images
							user={MockUserOwner}
							supportLinks={[]}
							onSignOut={vi.fn()}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	]);
	renderComponent(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	screen.getByRole("menuitem", { name: "Hide resource shortcuts" }).focus();
	await user.keyboard("{Enter}{Enter}");
	expect(router.state.location.pathname).toBe("/");
	await user.click(screen.getByRole("menuitem", { name: "Workspaces" }));
	expect(router.state.location.pathname).toBe("/workspaces");
});

it("adds consecutive shortcuts and saves the ordered choices", async () => {
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (settings) => settings);
	const user = userEvent.setup();
	const router = createMemoryRouter([
		{
			path: "*",
			element: (
				<DropdownMenu defaultOpen>
					<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
					<DropdownMenuContent>
						<SettingsResourceTray
							images
							user={MockUserOwner}
							supportLinks={[]}
							onSignOut={vi.fn()}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	]);
	renderComponent(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	await user.click(
		screen.getByRole("menuitem", { name: "Add resource shortcut" }),
	);
	(await screen.findByRole("button", { name: "Images" })).focus();
	await user.keyboard("{Enter}");
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			resource_shortcuts: ["images"],
		}),
	);
	await user.click(
		screen.getByRole("menuitem", { name: "Add resource shortcut" }),
	);
	(await screen.findByRole("button", { name: "HUD" })).focus();
	await user.keyboard("{Enter}");
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			resource_shortcuts: ["images", "hud"],
		}),
	);
	await user.click(
		screen.getByRole("menuitem", { name: "Add resource shortcut" }),
	);
	await user.click(await screen.findByRole("button", { name: "Leases" }));
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			resource_shortcuts: ["images", "hud", "leases"],
		}),
	);
	await user.click(await screen.findByRole("menuitem", { name: "Leases" }));
	expect(router.state.location.pathname + router.state.location.hash).toBe(
		"/deployment/users#short-term-leases",
	);
});

function renderTray(onSignOut = vi.fn()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const router = createMemoryRouter([
		{
			path: "*",
			element: (
				<DropdownMenu defaultOpen>
					<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
					<DropdownMenuContent>
						<SettingsResourceTray
							images
							user={MockUserOwner}
							supportLinks={[]}
							onSignOut={onSignOut}
							// an owner's Settings list, which has Templates
							pages={[
								{
									id: "templates",
									label: "Templates",
									path: "/templates",
									icon: LayoutTemplateIcon,
								},
							]}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	]);
	const view = renderComponent(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return { ...view, client, router };
}

it("saves the reordered permanent links without opening a workspace", async () => {
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (prefs) => prefs);
	const user = userEvent.setup();
	const { router } = renderTray();
	const workspaces = await screen.findByRole("menuitem", {
		name: "Workspaces",
	});
	workspaces.focus();
	await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			resource_shortcut_order: [
				"account",
				"dashboard",
				"templates",
				"workspaces",
			],
		}),
	);
	expect(router.state.location.pathname).toBe("/");
});
it.each(["top", "bottom"])(
	"locks with the %s dimple and restores visibility on remount",
	async (edge) => {
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (settings) => settings);
		const user = userEvent.setup();
		const first = renderTray();
		await user.click(
			await screen.findByRole("menuitem", { name: "Hide resource shortcuts" }),
		);
		await user.click(
			screen.getByRole("menuitemcheckbox", {
				name: `Lock resource shortcuts (${edge} dimple)`,
			}),
		);
		const preference = {
			resource_tray: { expanded: false, lock: "down" as const },
		};
		await waitFor(() =>
			expect(save).toHaveBeenCalledExactlyOnceWith(preference),
		);
		first.unmount();
		vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue(preference);
		renderTray();
		await user.click(
			await screen.findByRole("menuitem", { name: "Show resource shortcuts" }),
		);
		await waitFor(() =>
			expect(save).toHaveBeenLastCalledWith({
				resource_tray: { expanded: true, lock: "down" },
			}),
		);
		await user.click(
			screen.getByRole("menuitemcheckbox", {
				name: `Unlock resource shortcuts (${edge} dimple)`,
			}),
		);
		await waitFor(() =>
			expect(save).toHaveBeenLastCalledWith({ resource_tray: null }),
		);
	},
);

it("supports keyboard locking and preserves the previous preference if saving fails", async () => {
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (settings) => settings);
	const user = userEvent.setup();
	const { client } = renderTray();
	const grip = await screen.findByRole("menuitem", {
		name: "Hide resource shortcuts",
	});
	grip.focus();
	await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			resource_tray: { expanded: true, lock: "up" },
		}),
	);
	save.mockRejectedValueOnce(new Error("Unavailable"));
	await user.click(grip);
	await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
	await waitFor(() =>
		expect(client.getQueryData(userUIPreferences().queryKey)).toEqual({
			resource_tray: { expanded: true, lock: "up" },
		}),
	);
	grip.focus();
	await user.keyboard("{Shift>}{Home}{/Shift}");
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({ resource_tray: null }),
	);
});

it.each(["pointer", "keyboard"])(
	"opens the original user actions with %s and preserves their callbacks",
	async (input) => {
		const signOut = vi.fn();
		const contextMenu = vi.fn();
		const update = vi.spyOn(API, "updateAppearanceSettings").mockResolvedValue({
			...MockUserAppearanceSettings,
			theme_preference: "light",
		});
		const user = userEvent.setup();
		render(
			<DropdownMenu defaultOpen>
				<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
				<DropdownMenuContent onContextMenu={contextMenu}>
					<SettingsResourceTray
						images
						user={MockUserOwner}
						supportLinks={[]}
						onSignOut={signOut}
					/>
				</DropdownMenuContent>
			</DropdownMenu>,
		);
		const account = screen.getByRole("menuitem", { name: "Account" });
		if (input === "pointer") {
			await user.click(account);
		} else {
			account.focus();
			await user.keyboard("{Enter}");
		}
		const menu = within(
			await screen.findByRole("group", { name: "User menu" }),
		);
		await user.click(menu.getByRole("menuitem", { name: "Appearance" }));
		await user.click(menu.getByRole("menuitemcheckbox", { name: "Dark Mode" }));
		await waitFor(() =>
			expect(update).toHaveBeenCalledWith(
				expect.objectContaining({ theme_preference: "light" }),
			),
		);
		expect(contextMenu).not.toHaveBeenCalled();
		await user.click(menu.getByRole("menuitem", { name: "Close user menu" }));
		await user.click(account);
		await user.click(screen.getByRole("menuitem", { name: "Sign Out" }));
		expect(signOut).toHaveBeenCalledTimes(1);
	},
);

it.each(["pointer", "keyboard"])(
	"opens Account from the secondary %s menu",
	async (input) => {
		const user = userEvent.setup();
		const { router } = renderTray();
		const account = screen.getByRole("menuitem", { name: "Account" });
		if (input === "pointer")
			await user.pointer({ target: account, keys: "[MouseRight]" });
		else {
			account.focus();
			await user.keyboard("{Shift>}{F10}{/Shift}");
		}
		await user.click(
			await screen.findByRole("menuitem", { name: "View account" }),
		);
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/settings/account"),
		);
	},
);

it("removes an added shortcut from its context menu without changing permanent shortcuts", async () => {
	vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
		resource_shortcuts: ["hud", "images"],
	});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (settings) => settings);
	const user = userEvent.setup();
	const { router } = renderTray();
	await user.pointer({
		target: await screen.findByRole("menuitem", { name: "HUD" }),
		keys: "[MouseRight]",
	});
	await user.click(
		await screen.findByRole("menuitem", { name: "Remove HUD shortcut" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledExactlyOnceWith({
			resource_shortcuts: ["images"],
		}),
	);
	await user.keyboard("{Escape}");
	await user.click(screen.getByRole("button", { name: "Settings" }));
	await user.click(await screen.findByRole("menuitem", { name: "Templates" }));
	expect(router.state.location.pathname).toBe("/templates");
});

it("caps the tray at three permanent and three added shortcuts, then frees a removed slot", async () => {
	vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
		resource_shortcuts: ["hud", "images", "leases"],
	});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (settings) => settings);
	const user = userEvent.setup();
	render(
		<DropdownMenu defaultOpen>
			<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
			<DropdownMenuContent>
				<SettingsResourceTray
					images
					user={MockUserOwner}
					supportLinks={[]}
					onSignOut={vi.fn()}
					pages={[
						{
							id: "monitoring",
							label: "Monitoring",
							path: "/deployment/monitoring",
							icon: ActivityIcon,
						},
					]}
				/>
			</DropdownMenuContent>
		</DropdownMenu>,
	);
	await screen.findByRole("menuitem", { name: "Leases" });
	await user.click(
		screen.getByRole("menuitem", { name: "Add resource shortcut" }),
	);
	await user.click(await screen.findByRole("button", { name: "Monitoring" }));
	expect(save).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "HUD" }));
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			resource_shortcuts: ["images", "leases"],
		}),
	);
	await user.click(
		screen.getByRole("menuitem", { name: "Add resource shortcut" }),
	);
	await user.click(await screen.findByRole("button", { name: "Monitoring" }));
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			resource_shortcuts: ["images", "leases", "monitoring"],
		}),
	);
});

it("signs out through the selected resource shortcut", async () => {
	vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
		resource_shortcuts: ["logout"],
	});
	const signOut = vi.fn();
	renderTray(signOut);
	await userEvent
		.setup()
		.click(await screen.findByRole("menuitem", { name: "Sign out" }));
	expect(signOut).toHaveBeenCalledTimes(1);
});

it("opens the notification inbox from its quick link", async () => {
	vi.mocked(PlatformAPI.getUserUIPreferences).mockResolvedValue({
		resource_shortcuts: ["inbox"],
	});
	const fetch = vi
		.spyOn(API, "getInboxNotifications")
		.mockResolvedValue({ notifications: [], unread_count: 0 });
	renderTray(vi.fn());
	await userEvent
		.setup()
		.click(await screen.findByRole("button", { name: "Inbox" }));
	await waitFor(() => expect(fetch).toHaveBeenCalled());
	await screen.findByText("Inbox");
});
