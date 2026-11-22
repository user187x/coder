import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsersIcon } from "lucide-react";
import { PlatformAPI } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { render } from "#/testHelpers/renderHelpers";
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
