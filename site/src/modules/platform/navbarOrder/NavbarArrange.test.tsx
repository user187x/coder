import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { userUIPreferences } from "#/api/queries/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { NavbarArrange } from "./NavbarArrange";
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
it("moves, removes, restores and resets tiles, saving the layout", async () => {
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (settings) => settings);
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const client = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
	});
	client.setQueryData(userUIPreferences().queryKey, {});
	renderComponent(
		<QueryClientProvider client={client}>
			<NavbarArrange
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
	screen.getByRole("button", { name: "Move Page action" }).focus();
	await user.keyboard("{ArrowLeft}");
	await user.click(screen.getByRole("button", { name: "Done" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
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
				hidden: ["account"],
			},
		}),
	);
	act(() => startNavbarArrange());
	await user.click(screen.getByRole("button", { name: "Reset" }));
	act(() => startNavbarArrange());
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			navbar_layout: null,
		}),
	);
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
