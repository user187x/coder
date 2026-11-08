import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { PanelAccent } from "#/modules/platform/panelAccent/PanelAccent";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { PanelAccentSection } from "./PanelAccentSection";

afterEach(() => {
	vi.restoreAllMocks();
	delete document.documentElement.dataset.panelAccent;
	document.documentElement.style.removeProperty("--panel-accent");
});

describe("PanelAccentSection", () => {
	it("saves Follow theme, and the dashboard takes the theme's accent", async () => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => changes);
		renderWithAuth(
			<>
				<PanelAccentSection />
				<PanelAccent />
			</>,
		);
		await userEvent.click(
			await screen.findByRole("combobox", { name: "Accent" }),
		);
		await userEvent.click(screen.getByRole("option", { name: "Follow theme" }));
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({ panel_accent: { mode: "theme" } }),
		);
		await waitFor(() =>
			expect(
				document.documentElement.style.getPropertyValue("--panel-accent"),
			).toBe("hsl(var(--content-link))"),
		);
	});

	it("uses a custom colour of the user's own", async () => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
			panel_accent: { mode: "custom", color: "#12ab34" },
		});
		renderWithAuth(<PanelAccent />);
		await waitFor(() =>
			expect(
				document.documentElement.style.getPropertyValue("--panel-accent"),
			).toBe("#12ab34"),
		);
	});
});
