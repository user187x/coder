import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { MockBackgrounds } from "#/testHelpers/appearance";
import { render } from "#/testHelpers/renderHelpers";
import { BackgroundSection } from "./BackgroundSection";

afterEach(() => vi.restoreAllMocks());
it("keeps both tab drafts and saves them together without an intervening save", async () => {
	vi.spyOn(PlatformAPI, "getBackgrounds").mockResolvedValue(MockBackgrounds);
	const save = vi
		.spyOn(PlatformAPI, "saveBackground")
		.mockResolvedValue({ ok: true, set: true });
	render(<BackgroundSection />);
	fireEvent.change(
		await screen.findByLabelText("Dashboard background strength"),
		{ target: { value: "18" } },
	);
	await userEvent.click(
		screen.getByRole("tab", { name: "Sign-in / sign-out" }),
	);
	fireEvent.change(screen.getByLabelText("Sign-in page background strength"), {
		target: { value: "22" },
	});
	await userEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
	expect(save).not.toHaveBeenCalled();
	await userEvent.click(
		screen.getByRole("button", { name: "Save backgrounds" }),
	);
	await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
	expect(save).toHaveBeenCalledWith(
		"dashboard",
		expect.objectContaining({ opacity: 0.18 }),
	);
	expect(save).toHaveBeenCalledWith(
		"login",
		expect.objectContaining({ opacity: 0.22 }),
	);
});

it("retries only the unsaved background after a partial failure", async () => {
	vi.spyOn(PlatformAPI, "getBackgrounds").mockResolvedValue(MockBackgrounds);
	const save = vi
		.spyOn(PlatformAPI, "saveBackground")
		.mockResolvedValueOnce({ ok: true, set: true })
		.mockRejectedValueOnce(new Error("Temporary failure"))
		.mockResolvedValue({ ok: true, set: true });
	render(<BackgroundSection />);
	fireEvent.change(
		await screen.findByLabelText("Dashboard background strength"),
		{ target: { value: "18" } },
	);
	await userEvent.click(
		screen.getByRole("tab", { name: "Sign-in / sign-out" }),
	);
	fireEvent.change(screen.getByLabelText("Sign-in page background strength"), {
		target: { value: "22" },
	});
	await userEvent.click(
		screen.getByRole("button", { name: "Save backgrounds" }),
	);
	await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
	await userEvent.click(
		screen.getByRole("button", { name: "Save backgrounds" }),
	);
	await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
	expect(save.mock.calls[2]).toEqual([
		"dashboard",
		expect.objectContaining({ opacity: 0.18 }),
	]);
});

it("stages removal until the shared save action", async () => {
	vi.spyOn(PlatformAPI, "getBackgrounds").mockResolvedValue(MockBackgrounds);
	const remove = vi
		.spyOn(PlatformAPI, "resetBackground")
		.mockResolvedValue({ ok: true, set: false });
	render(<BackgroundSection />);
	const panel = await screen.findByRole("tabpanel", { name: "Dashboard" });
	await userEvent.click(within(panel).getByRole("button", { name: "Remove" }));
	expect(remove).not.toHaveBeenCalled();
	await userEvent.click(
		screen.getByRole("button", { name: "Save backgrounds" }),
	);
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
	await userEvent.click(
		screen.getByRole("button", { name: "Save backgrounds" }),
	);
	await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
	const [slot, body] = save.mock.calls[0];
	expect(slot).toBe("dashboard");
	expect(body.params?.preset).toMatchObject({ name: "lava", fit: "tile" });
	expect(body.html).toContain('F="tile"');
	expect(body.html?.match(/class="blob"/g)).toHaveLength(7);
});
