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
					"notifications",
					"account",
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
			navbar_layout: { order: [...NAVBAR_ITEMS], hidden: [] },
		}),
	);
});
