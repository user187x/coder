import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { userUIPreferences } from "#/api/queries/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { NavbarArrange, restrictToRow } from "./NavbarArrange";
import {
	NAVBAR_ITEMS,
	normalizeOrder,
	startNavbarArrange,
} from "./navbarOrder";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("preserves the legacy order and inserts the newly movable edge tiles", () => {
	expect(normalizeOrder(["hud", "banner", "x", "hud"])).toEqual([
		"logo",
		"hud",
		"banner",
		"workspaces",
		"latency",
		"notifications",
		"account",
		"action",
	]);
	expect(normalizeOrder(null)).toEqual(NAVBAR_ITEMS);
});
it("loads a stored order saved before the action was movable", () => {
	localStorage.setItem(
		"coder-ui-navbar-order",
		JSON.stringify(["logo", "account", "workspaces"]),
	);
	expect(normalizeOrder(["logo", "account", "workspaces"]).at(-1)).toBe(
		"action",
	);
	expect(normalizeOrder(["action", "logo"])).toEqual([
		"action",
		"logo",
		...NAVBAR_ITEMS.filter((id) => id !== "action" && id !== "logo"),
	]);
});

describe("restrictToRow", () => {
	const rect = (left: number, right: number) =>
		({
			left,
			right,
			top: 0,
			bottom: 10,
			width: right - left,
			height: 10,
		}) as DOMRect;
	const row = (left: number, right: number) => {
		const element = document.createElement("div");
		element.getBoundingClientRect = () => rect(left, right);
		return element;
	};
	const run = (x: number, element: HTMLElement | null) =>
		restrictToRow(() => element)({
			transform: { x, y: 50, scaleX: 1, scaleY: 1 },
			draggingNodeRect: rect(200, 260) as never,
		} as never);

	it("clamps a drag far past either edge and locks y", () => {
		const element = row(100, 500);
		expect(run(5000, element)).toMatchObject({ x: 240, y: 0 });
		expect(run(-5000, element)).toMatchObject({ x: -100, y: 0 });
		expect(run(30, element)).toMatchObject({ x: 30 });
	});

	it("divides the clamped offset by the navbar zoom", () => {
		const element = row(100, 500);
		vi.spyOn(window, "getComputedStyle").mockReturnValue({
			getPropertyValue: () => "2",
		} as never);
		expect(run(5000, element)).toMatchObject({ x: 120 });
		expect(run(-5000, element)).toMatchObject({ x: -50 });
	});
});

it("publishes the inherited order without writing a personal override", async () => {
	const layout = {
		order: ["action", ...NAVBAR_ITEMS.filter((id) => id !== "action")],
		hidden: ["logo"],
	};
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const personal = vi.spyOn(PlatformAPI, "setUserUIPreferences");
	const publish = vi
		.spyOn(PlatformAPI, "setNavbarLayoutDefault")
		.mockResolvedValue({
			transparency: 0,
			scale: 100,
			wireframe: true,
			defaultLayout: layout,
		});
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<NavbarArrange
				canSetDefault
				defaultLayout={layout}
				items={{
					logo: null,
					workspaces: <span>Resources</span>,
					banner: <span>Banner</span>,
					latency: null,
					hud: null,
					notifications: null,
					account: null,
					action: <span>Workspace</span>,
				}}
			/>
		</QueryClientProvider>,
	);
	const user = userEvent.setup();
	act(() => startNavbarArrange());
	await user.click(
		screen.getByRole("button", { name: "Set deployment default" }),
	);
	await waitFor(() => expect(publish).toHaveBeenCalledWith(layout));
	await user.click(screen.getByRole("button", { name: "Done" }));
	expect(personal).not.toHaveBeenCalled();
});

it("saves Hide from a control to the right of the banner", async () => {
	const order = [
		"logo",
		"banner",
		"workspaces",
		"latency",
		"hud",
		"notifications",
		"account",
		"action",
	];
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		navbar_layout: { order, hidden: ["notifications"] },
	});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (changes) => changes);
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<NavbarArrange
				items={{
					logo: <button type="button">Logo</button>,
					workspaces: <button type="button">Resources</button>,
					banner: <span>Banner</span>,
					latency: null,
					hud: null,
					notifications: null,
					account: null,
					action: null,
				}}
			/>
		</QueryClientProvider>,
	);
	const user = userEvent.setup();
	await user.pointer({
		target: await screen.findByRole("button", { name: "Logo" }),
		keys: "[MouseRight]",
	});
	expect(screen.queryByRole("menuitem", { name: "Hide" })).toBeNull();
	await user.pointer({
		target: screen.getByRole("button", { name: "Resources" }),
		keys: "[MouseRight]",
	});
	await user.click(await screen.findByRole("menuitem", { name: "Hide" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			navbar_layout: { order, hidden: ["notifications", "workspaces"] },
		}),
	);
});

it("restores a removed item from a non-focusable live preview", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (settings) => settings);
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<NavbarArrange
				items={{
					logo: null,
					workspaces: <button type="button">Resources</button>,
					banner: null,
					latency: null,
					hud: null,
					notifications: null,
					account: null,
					action: null,
				}}
			/>
		</QueryClientProvider>,
	);
	const user = userEvent.setup();
	act(() => startNavbarArrange());
	await user.click(screen.getByRole("button", { name: "Remove Workspaces" }));
	const restore = screen.getByRole("button", { name: "Restore Workspaces" });
	expect(restore).toHaveTextContent("Resources");
	expect(restore.querySelector("[inert]")).not.toBeNull();
	expect(screen.queryByRole("button", { name: "Resources" })).toBeNull();
	await user.click(restore);
	expect(
		screen.queryByRole("button", { name: "Restore Workspaces" }),
	).toBeNull();
	await user.click(screen.getByRole("button", { name: "Done" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			navbar_layout: expect.objectContaining({ hidden: [] }),
		}),
	);
});

it("moves, removes, restores and resets tiles, saving the layout", async () => {
	const preferences = {};
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (settings) => ({
			...Object.assign(preferences, settings),
		}));
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const client = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
	});
	client.setQueryData(userUIPreferences().queryKey, {});
	renderComponent(
		<QueryClientProvider client={client}>
			<NavbarArrange
				showSettingsChevrons
				items={{
					logo: null,
					workspaces: <span>Resources</span>,
					banner: <span>Announcement</span>,
					latency: <span>Settings</span>,
					hud: null,
					notifications: <span>Notifications</span>,
					account: <span>Account</span>,
					action: <button type="button">Workspace</button>,
				}}
			/>
		</QueryClientProvider>,
	);
	const user = userEvent.setup();
	act(() => startNavbarArrange());
	await user.click(screen.getByRole("button", { name: "Remove Logo" }));
	await user.click(screen.getByRole("button", { name: "Restore Logo" }));
	screen.getByRole("button", { name: "Move Logo" }).focus();
	await user.keyboard("{ArrowRight}");
	await user.click(screen.getByRole("button", { name: "Remove Account" }));
	await user.click(
		screen.getByRole("button", { name: "Remove Notifications" }),
	);
	await user.click(
		screen.getByRole("button", { name: "Restore Notifications" }),
	);
	screen.getByRole("button", { name: "Move Action Button" }).focus();
	await user.keyboard("{ArrowLeft}");
	await user.click(
		screen.getByRole("button", { name: "Remove Action Button" }),
	);
	const restoreAction = screen.getByRole("button", {
		name: "Restore Action Button",
	});
	expect(restoreAction).toHaveTextContent("Action Button");
	await user.click(restoreAction);
	await user.click(
		screen.getByRole("button", { name: "Remove Action Button" }),
	);
	const chevrons = screen.getByRole("button", {
		name: "Move Settings chevrons",
	});
	chevrons.focus();
	await user.keyboard("{ArrowRight}");
	await user.click(screen.getByRole("button", { name: "Done" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			navbar_settings_side: "right",
			navbar_layout: {
				order: [
					"workspaces",
					"logo",
					"banner",
					"latency",
					"hud",
					"action",
					"account",
					"notifications",
				],
				hidden: ["account", "action"],
			},
		}),
	);
	expect(screen.queryByRole("button", { name: "Workspace" })).toBeNull();
	act(() => startNavbarArrange());
	await user.click(screen.getByRole("button", { name: "Reset" }));
	act(() => startNavbarArrange());
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			navbar_layout: null,
		}),
	);

	act(() => startNavbarArrange());
	const savedChevrons = screen.getByRole("button", {
		name: "Move Settings chevrons",
	});
	const toolbar = screen.getByTestId("navbar-arrange");
	const chevronTile = savedChevrons.closest(
		'[data-navbar-item="settings-chevrons"]',
	);
	if (!chevronTile) throw new Error("Missing Settings chevrons tile");
	vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 0, 600, 50),
	);
	vi.spyOn(chevronTile, "getBoundingClientRect").mockReturnValue(
		new DOMRect(480, 0, 120, 50),
	);
	await user.pointer([
		{ keys: "[MouseLeft>]", target: savedChevrons, coords: { x: 540, y: 25 } },
		{ coords: { x: 525, y: 25 } },
		{ coords: { x: 70, y: 25 } },
		{ keys: "[/MouseLeft]" },
	]);
	savedChevrons.focus();
	await user.keyboard("{Enter}");
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({ navbar_settings_side: "left" }),
	);
});

it("moves the docked Settings sidebar to either edge with the arrow keys", async () => {
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (changes) => ({
			settings_sidebar: true,
			...changes,
		}));
	const client = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
	});
	client.setQueryData(userUIPreferences().queryKey, { settings_sidebar: true });
	renderComponent(
		<QueryClientProvider client={client}>
			<NavbarArrange
				showSettingsChevrons
				settingsDocked
				items={{
					logo: null,
					workspaces: null,
					banner: <span>Announcement</span>,
					latency: null,
					hud: null,
					notifications: null,
					account: null,
					action: null,
				}}
			/>
		</QueryClientProvider>,
	);
	const user = userEvent.setup();
	for (const side of ["Left", "Right"]) {
		act(() => startNavbarArrange());
		screen.getByRole("button", { name: "Move Settings sidebar" }).focus();
		await user.keyboard(`{Arrow${side}}`);
		await user.click(screen.getByRole("button", { name: "Done" }));
		await waitFor(() =>
			expect(save).toHaveBeenLastCalledWith({
				navbar_settings_side: side.toLowerCase(),
			}),
		);
	}
});
