import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import { NavbarAppearance } from "./NavbarAppearance";

afterEach(() => vi.restoreAllMocks());

it("previews the background locally and persists only the saved percentage", async () => {
	vi.spyOn(PlatformAPI, "getNavbarAppearance").mockResolvedValue({
		transparency: 20,
	});
	const save = vi
		.spyOn(PlatformAPI, "setNavbarAppearance")
		.mockResolvedValue({ transparency: 65 });
	const user = userEvent.setup();
	render(<NavbarAppearance />);
	const slider = await screen.findByRole("slider", {
		name: "Navbar transparency",
	});
	const preview = () =>
		document.documentElement.style.getPropertyValue("--navbar-preview-alpha");
	fireEvent.change(slider, { target: { value: "100" } });
	expect(preview()).toBe("0");
	await user.click(screen.getByRole("button", { name: "Discard changes" }));
	expect(preview()).toBe("");
	expect(save).not.toHaveBeenCalled();
	fireEvent.change(slider, { target: { value: "65" } });
	await user.click(
		screen.getByRole("button", { name: "Save navbar appearance" }),
	);
	await waitFor(() => expect(save).toHaveBeenCalledWith(65));
	await waitFor(() => expect(preview()).toBe(""));
});
