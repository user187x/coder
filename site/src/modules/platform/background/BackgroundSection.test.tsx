import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { MockBackgrounds } from "#/testHelpers/appearance";
import { render } from "#/testHelpers/renderHelpers";
import { BackgroundSection } from "./BackgroundSection";

afterEach(() => vi.restoreAllMocks());
it("saves dashboard fit and layer without changing the login background", async () => {
	vi.spyOn(PlatformAPI, "getBackgrounds").mockResolvedValue(MockBackgrounds);
	const save = vi
		.spyOn(PlatformAPI, "saveBackground")
		.mockResolvedValue({ ok: true, set: true });
	const user = userEvent.setup();
	render(<BackgroundSection />);
	await user.selectOptions(
		await screen.findByRole("combobox", { name: "Fit" }),
		"span",
	);
	await user.click(screen.getByLabelText("Over the page, as a watermark"));
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledExactlyOnceWith(
			"dashboard",
			expect.objectContaining({ fit: "span", layer: "over" }),
		),
	);
});

it("stages removal until the shared save action", async () => {
	vi.spyOn(PlatformAPI, "getBackgrounds").mockResolvedValue(MockBackgrounds);
	const remove = vi
		.spyOn(PlatformAPI, "resetBackground")
		.mockResolvedValue({ ok: true, set: false });
	render(<BackgroundSection />);
	await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
	expect(remove).not.toHaveBeenCalled();
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(remove).toHaveBeenCalledWith("dashboard"));
});

it("saves the lava lamp as a preset, its HTML drawn from its settings", async () => {
	vi.spyOn(PlatformAPI, "getBackgrounds").mockResolvedValue(MockBackgrounds);
	const save = vi
		.spyOn(PlatformAPI, "saveBackground")
		.mockResolvedValue({ ok: true, set: true });
	render(<BackgroundSection />);
	const card = await screen.findByTestId("background-dashboard");
	await userEvent.click(within(card).getByRole("combobox", { name: "Source" }));
	await userEvent.click(
		await screen.findByRole("option", { name: "Lava lamp" }),
	);
	await userEvent.click(within(card).getByRole("button", { name: "Add lava" }));
	await userEvent.selectOptions(within(card).getByLabelText("Fit"), "tile");
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
	const [slot, body] = save.mock.calls[0];
	expect(slot).toBe("dashboard");
	expect(body.params?.preset).toMatchObject({ name: "lava", fit: "tile" });
	expect(body.html).toContain('F="tile"');
	expect(body.html?.match(/class="blob"/g)).toHaveLength(7);
});

it("saves an editable gradient preset at full strength", async () => {
	vi.spyOn(PlatformAPI, "getBackgrounds").mockResolvedValue(MockBackgrounds);
	const save = vi
		.spyOn(PlatformAPI, "saveBackground")
		.mockResolvedValue({ ok: true, set: true });
	const user = userEvent.setup();
	render(<BackgroundSection />);
	await user.click(await screen.findByRole("combobox", { name: "Source" }));
	await user.click(screen.getByRole("option", { name: "Color or gradient" }));
	await user.click(screen.getByRole("combobox", { name: "Fill style" }));
	await user.click(screen.getByRole("option", { name: "Linear gradient" }));
	await user.clear(screen.getByLabelText("Angle (degrees)"));
	await user.type(screen.getByLabelText("Angle (degrees)"), "90");
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(
			"dashboard",
			expect.objectContaining({
				opacity: 1,
				params: {
					preset: expect.objectContaining({
						name: "fill",
						mode: "linear",
						angle: 90,
					}),
				},
				html: expect.stringContaining("linear-gradient(90deg"),
			}),
		),
	);
});
