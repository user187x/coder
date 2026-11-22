import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsersIcon } from "lucide-react";
import { createMemoryRouter } from "react-router";
import { PlatformAPI } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { MockPermissions } from "#/testHelpers/entities";
import { render, renderWithRouter } from "#/testHelpers/renderHelpers";
import { settingsPagesFor } from "./adminQuickLinks";
import { SettingsCategoryDropdown } from "./SettingsCategoryDropdown";

afterEach(() => vi.restoreAllMocks());

it("saves category moves, sorts alphabetically, and opens Profile", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (preferences) => preferences);
	const { router } = render(
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button>Open categories</Button>
			</DropdownMenuTrigger>
			<SettingsCategoryDropdown
				categories={[
					{
						id: "accounts",
						label: "Accounts",
						icon: UsersIcon,
						path: "/deployment/users",
					},
				]}
				quickLinks={[]}
				hud
			/>
		</DropdownMenu>,
	);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Open categories" }));
	const menu = within(
		await screen.findByRole("menu", { name: "Settings categories" }),
	);
	const profile = menu.getByRole("menuitem", { name: "Profile" });
	profile.focus();
	await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			settings_category_order: ["user-settings", "hud", "profile", "accounts"],
		}),
	);

	await user.click(
		menu.getByRole("menuitem", { name: "List the categories alphabetically" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({ settings_category_order: [] }),
	);
	await user.click(menu.getByRole("menuitem", { name: "Profile" }));
	expect(router.state.location.pathname).toBe("/settings/account");
});

it("marks only the current category after selecting Ping and Latency, HUD, or Profile", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const categories = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button>Open categories</Button>
			</DropdownMenuTrigger>
			<SettingsCategoryDropdown
				categories={settingsPagesFor({
					permissions: MockPermissions,
					oauth2Provider: true,
				})}
				quickLinks={[]}
				hud
			/>
		</DropdownMenu>
	);
	const { router } = renderWithRouter(
		createMemoryRouter([{ path: "*", element: categories }], {
			initialEntries: ["/hud"],
		}),
	);
	const user = userEvent.setup();
	const open = () =>
		user.click(screen.getByRole("button", { name: "Open categories" }));
	await open();
	for (const [selected, other] of [
		["Ping and Latency", "HUD"],
		["HUD", "Ping and Latency"],
		["Profile", "User Settings"],
	]) {
		await user.click(await screen.findByRole("menuitem", { name: selected }));
		await open();
		expect(screen.getByRole("menuitem", { name: selected })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("menuitem", { name: other })).not.toHaveAttribute(
			"aria-current",
		);
	}
	await act(() => router.navigate("/settings/ssh-keys"));
	expect(
		screen.getByRole("menuitem", { name: "User Settings" }),
	).toHaveAttribute("aria-current", "page");
	expect(screen.getByRole("menuitem", { name: "Profile" })).not.toHaveAttribute(
		"aria-current",
	);
});
