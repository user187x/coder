import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import { NavbarAppearance } from "./NavbarAppearance";

afterEach(() => vi.restoreAllMocks());

it("previews the background locally and persists only the saved percentage", async () => {
	vi.spyOn(PlatformAPI, "getNavbarAppearance").mockResolvedValue({
		transparency: 20,
		scale: 100,
		wireframe: true,
	});
	const save = vi
		.spyOn(PlatformAPI, "setNavbarAppearance")
		.mockResolvedValue({ transparency: 65, scale: 110, wireframe: false });
	const user = userEvent.setup();
	render(<NavbarAppearance />);
	const slider = await screen.findByRole("slider", {
		name: "Navbar transparency",
	});
	const preview = () =>
		document.documentElement.style.getPropertyValue("--navbar-preview-strip");
	fireEvent.change(slider, { target: { value: "100" } });
	expect(preview()).toBe("hsl(var(--surface-primary) / 0)");
	await user.click(screen.getByRole("button", { name: "Discard changes" }));
	expect(preview()).toBe("");
	expect(save).not.toHaveBeenCalled();
	fireEvent.change(slider, { target: { value: "65" } });
	fireEvent.change(screen.getByRole("slider", { name: "Navbar size" }), {
		target: { value: "110" },
	});
	await user.click(
		screen.getByRole("switch", { name: "Show navbar wireframe" }),
	);
	await user.click(
		screen.getByRole("button", { name: "Save navbar appearance" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			transparency: 65,
			scale: 110,
			wireframe: false,
		}),
	);
	await waitFor(() => expect(preview()).toBe(""));
});

it("previews and saves a backstrip colour, and goes back to the theme's", async () => {
	vi.spyOn(PlatformAPI, "getNavbarAppearance").mockResolvedValue({
		transparency: 50,
		scale: 100,
		wireframe: true,
		color: "#102030",
	});
	const save = vi
		.spyOn(PlatformAPI, "setNavbarAppearance")
		.mockResolvedValue({ transparency: 50, scale: 100, wireframe: true });
	const user = userEvent.setup();
	render(<NavbarAppearance />);
	const picker = await screen.findByLabelText("Navbar backstrip color");
	fireEvent.change(picker, { target: { value: "#ff8800" } });
	expect(
		document.documentElement.style.getPropertyValue("--navbar-preview-strip"),
	).toBe("rgb(255 136 0 / 0.5)");
	await user.click(screen.getByRole("button", { name: "Use theme color" }));
	await user.click(
		screen.getByRole("button", { name: "Save navbar appearance" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			transparency: 50,
			scale: 100,
			wireframe: true,
			color: null,
		}),
	);
});
