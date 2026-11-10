import { fireEvent, screen, waitFor } from "@testing-library/react";
import { PlatformAPI } from "#/api/platform";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { NavbarLayoutSection } from "./NavbarLayoutSection";

it("starts arranging the top bar, and resets it to the default layout", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		navbar_layout: { order: ["workspaces", "logo"], hidden: ["hud"] },
	});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockResolvedValue({ navbar_layout: null });
	const arranging = vi.fn();
	window.addEventListener("coder-ui-navbar-arrange", arranging);
	renderWithAuth(<NavbarLayoutSection />);
	fireEvent.click(
		await screen.findByRole("button", { name: "Rearrange top bar" }),
	);
	expect(arranging).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({ navbar_layout: null }),
	);
	window.removeEventListener("coder-ui-navbar-arrange", arranging);
});

it("moves the Settings chevron to the navbar's right end", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_nav_in_navbar: true,
	});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (changes) => changes);
	renderWithAuth(<NavbarLayoutSection />);
	fireEvent.click(
		await screen.findByRole("switch", { name: "Settings on the right" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({ navbar_settings_side: "right" }),
	);
});
