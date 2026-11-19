import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { MockUserPreferenceSettings } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { AdminCategoryMenu } from "./AdminCategoryMenu";

it("opens Accounts from the Admin breadcrumb", async () => {
	const { router } = renderWithAuth(<AdminCategoryMenu />);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("link", { name: "Settings" }));
	expect(router.state.location.pathname).toBe("/deployment/users");
});
it("navigates from the right-click category menu", async () => {
	const { router } = renderWithAuth(<AdminCategoryMenu />);
	const user = userEvent.setup();
	await user.pointer({
		target: await screen.findByRole("link", { name: "Settings" }),
		keys: "[MouseRight]",
	});
	await user.click(await screen.findByRole("menuitem", { name: "Appearance" }));
	expect(router.state.location.pathname).toBe("/deployment/customize");
});

it("labels the root chevron with the saved home and opens it", async () => {
	const read = vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		settings_default_view: "/deployment/storage",
	});
	try {
		const { router } = renderWithAuth(<AdminCategoryMenu />);
		await userEvent.click(await screen.findByRole("link", { name: "Storage" }));
		expect(router.state.location.pathname).toBe("/deployment/storage");
	} finally {
		read.mockRestore();
	}
});

it("lists Profile and saves category order from the keyboard", async () => {
	const order = ["profile", "accounts"];
	const read = vi.spyOn(API, "getUserPreferenceSettings").mockResolvedValue({
		...MockUserPreferenceSettings,
		admin_sidebar_order: order,
	});
	const save = vi
		.spyOn(API, "updateUserPreferenceSettings")
		.mockImplementation(async (prefs) => {
			read.mockResolvedValue({
				admin_sidebar_order: prefs.admin_sidebar_order ?? [],
				admin_quick_links: [],
			});
			return API.getUserPreferenceSettings();
		});
	try {
		renderWithAuth(<AdminCategoryMenu />);
		const user = userEvent.setup();
		await user.pointer({
			target: await screen.findByRole("link", { name: "Settings" }),
			keys: "[MouseRight]",
		});
		const menu = within(
			await screen.findByRole("menu", { name: "Admin categories" }),
		);
		const profile = menu.getByRole("menuitem", { name: "Profile" });
		expect(profile).toHaveAttribute("href", "/settings/account");
		await waitFor(() => expect(menu.getAllByRole("menuitem")[0]).toBe(profile));
		profile.focus();
		await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({
				admin_sidebar_order: expect.arrayContaining(["accounts", "profile"]),
			}),
		);
		expect(menu.getAllByRole("menuitem")[0]).toHaveTextContent("Accounts");
	} finally {
		read.mockRestore();
		save.mockRestore();
	}
});
