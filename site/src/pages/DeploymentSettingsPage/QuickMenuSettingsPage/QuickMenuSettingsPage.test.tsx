import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { MockQuickMenu } from "#/testHelpers/appearance";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import QuickMenuSettingsPage from "./QuickMenuSettingsPage";

beforeEach(() =>
	vi.spyOn(PlatformAPI, "getQuickMenu").mockResolvedValue(MockQuickMenu),
);
afterEach(() => vi.restoreAllMocks());

it("adds Leases and saves Ctrl+Escape by default", async () => {
	const save = vi
		.spyOn(PlatformAPI, "saveQuickMenu")
		.mockResolvedValue(MockQuickMenu);
	const user = userEvent.setup();
	renderWithAuth(<QuickMenuSettingsPage />);
	await user.click(await screen.findByRole("button", { name: "Add a wedge" }));
	await user.click(screen.getByRole("menuitem", { name: "Leases" }));
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(
			expect.arrayContaining(["leases"]),
			"Ctrl+Escape",
			true,
		),
	);
});

it("preserves a custom shortcut when disabling the menu", async () => {
	vi.mocked(PlatformAPI.getQuickMenu).mockResolvedValue({
		...MockQuickMenu,
		shortcut: "Ctrl+Shift+K",
	});
	const save = vi
		.spyOn(PlatformAPI, "saveQuickMenu")
		.mockResolvedValue(MockQuickMenu);
	const user = userEvent.setup();
	renderWithAuth(<QuickMenuSettingsPage />);
	await user.click(
		await screen.findByRole("switch", { name: "Enable Quick Menu" }),
	);
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(expect.any(Array), "Ctrl+Shift+K", false),
	);
});

it("records a custom shortcut and restores the default combination", async () => {
	const save = vi
		.spyOn(PlatformAPI, "saveQuickMenu")
		.mockImplementation(async (items, shortcut, enabled) => ({
			...MockQuickMenu,
			items,
			shortcut,
			enabled,
		}));
	const user = userEvent.setup();
	renderWithAuth(<QuickMenuSettingsPage />);
	await user.click(
		await screen.findByRole("button", { name: "Record shortcut" }),
	);
	await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(expect.any(Array), "Ctrl+Shift+K", true),
	);
	await user.click(screen.getByRole("button", { name: "Use Ctrl+Escape" }));
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith(
			expect.any(Array),
			"Ctrl+Escape",
			true,
		),
	);
});

it("restores the server defaults", async () => {
	vi.mocked(PlatformAPI.getQuickMenu).mockResolvedValue({
		...MockQuickMenu,
		items: ["workspaces", "leases", "accounts"],
	});
	const reset = vi
		.spyOn(PlatformAPI, "resetQuickMenu")
		.mockResolvedValue(MockQuickMenu);
	const user = userEvent.setup();
	renderWithAuth(<QuickMenuSettingsPage />);
	await user.click(
		await screen.findByRole("button", { name: "Reset to default" }),
	);
	await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
});
