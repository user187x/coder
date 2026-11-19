import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import { NavbarResizableGroup } from "./NavbarResizableGroup";

afterEach(() => vi.restoreAllMocks());

const setup = async (width: number) => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		navbar_floating: true,
		navbar_resizable_width: width,
	});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (changes) => changes);
	render(
		<NavbarResizableGroup resizable>
			<button type="button">Workspaces</button>
		</NavbarResizableGroup>,
	);
	const handle = await screen.findByRole("separator", {
		name: /from its right end/,
	});
	await waitFor(() =>
		expect(handle).toHaveAttribute("aria-valuenow", String(width)),
	);
	return { save, handle };
};

it("widens from the right handle with the arrow keys and saves the width", async () => {
	const { save, handle } = await setup(50);
	handle.focus();
	await userEvent.keyboard("{ArrowRight}");
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({ navbar_resizable_width: 52 }),
		),
	);
});

it.each(["left", "right"])(
	"expands to maximum width when double-clicking the %s handle",
	async (side) => {
		const { save } = await setup(60);
		await userEvent.dblClick(
			screen.getByRole("separator", {
				name: `Resize the navigation bar from its ${side} end`,
			}),
		);
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({ navbar_resizable_width: 100 }),
		);
		expect(save).toHaveBeenCalledTimes(1);
	},
);
