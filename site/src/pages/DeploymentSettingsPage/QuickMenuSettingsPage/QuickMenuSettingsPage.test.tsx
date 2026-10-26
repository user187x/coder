import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import QuickMenuSettingsPage from "./QuickMenuSettingsPage";

const wedgeIds = () =>
	within(screen.getByTestId("quick-menu-list"))
		.getAllByRole("listitem")
		.map((li) =>
			li.getAttribute("data-testid")?.replace("quick-menu-wedge-", ""),
		);

describe("QuickMenuSettingsPage", () => {
	afterEach(() => vi.restoreAllMocks());

	it("arranges the wheel's wedges - up, off, an admin category added - and saves them for everyone", async () => {
		vi.spyOn(PlatformAPI, "getQuickMenu").mockResolvedValue({
			items: null,
			wedges: [3, 12],
		});
		const save = vi
			.spyOn(PlatformAPI, "saveQuickMenu")
			.mockImplementation(async (items) => ({
				items,
				wedges: [3, 12],
				updatedBy: "admin",
			}));
		renderWithAuth(<QuickMenuSettingsPage />);
		await screen.findByTestId("quick-menu-list");
		expect(wedgeIds()).toEqual([
			"workspaces",
			"templates",
			"images",
			"accounts",
			"account",
			"chat",
			"announcement",
			"hud",
		]);
		// the preview is the wheel itself
		expect(
			within(screen.getByTestId("quick-menu-preview")).getAllByRole("menuitem"),
		).toHaveLength(8);
		expect(screen.getByTestId("quick-menu-save")).toBeDisabled();

		await userEvent.click(
			screen.getByRole("button", { name: "Move Images up" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Take Account off the wheel" }),
		);
		await userEvent.click(screen.getByTestId("quick-menu-add"));
		await userEvent.click(await screen.findByTestId("quick-menu-add-security"));
		expect(wedgeIds()).toEqual([
			"workspaces",
			"images",
			"templates",
			"accounts",
			"chat",
			"announcement",
			"hud",
			"security",
		]);
		expect(
			within(screen.getByTestId("quick-menu-preview")).getAllByRole("menuitem"),
		).toHaveLength(8);

		await userEvent.click(screen.getByTestId("quick-menu-save"));
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith(
				[
					"workspaces",
					"images",
					"templates",
					"accounts",
					"chat",
					"announcement",
					"hud",
					"security",
				],
				"Escape",
			),
		);
	});

	it("keeps at least three wedges, and puts the default back", async () => {
		vi.spyOn(PlatformAPI, "getQuickMenu").mockResolvedValue({
			items: ["security", "images", "health"],
			wedges: [3, 12],
			updatedBy: "admin",
		});
		const reset = vi
			.spyOn(PlatformAPI, "resetQuickMenu")
			.mockResolvedValue({ items: null, wedges: [3, 12] });
		renderWithAuth(<QuickMenuSettingsPage />);
		await screen.findByTestId("quick-menu-list");
		expect(wedgeIds()).toEqual(["security", "images", "health"]);
		expect(
			screen.getByRole("button", { name: "Take Images off the wheel" }),
		).toBeDisabled();
		await userEvent.click(screen.getByTestId("quick-menu-reset"));
		await waitFor(() => expect(reset).toHaveBeenCalled());
		await waitFor(() => expect(wedgeIds()).toHaveLength(8));
	});
});

it("captures and saves a key combination with the current wedges", async () => {
	vi.spyOn(PlatformAPI, "getQuickMenu").mockResolvedValue({
		items: null,
		wedges: [3, 12],
		shortcut: "Escape",
	});
	const save = vi
		.spyOn(PlatformAPI, "saveQuickMenu")
		.mockImplementation(async (items, shortcut) => ({
			items,
			shortcut,
			wedges: [3, 12],
		}));
	renderWithAuth(<QuickMenuSettingsPage />);
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", { name: "Record shortcut" }),
	);
	await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
	await user.click(screen.getByTestId("quick-menu-save"));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(expect.any(Array), "Ctrl+Shift+K"),
	);
});
