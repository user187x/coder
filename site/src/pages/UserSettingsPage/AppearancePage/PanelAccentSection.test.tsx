import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
		vi.spyOn(PlatformAPI, "getPanelAccentGlobal").mockResolvedValue({
			global: null,
		});
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
		vi.spyOn(PlatformAPI, "getPanelAccentGlobal").mockResolvedValue({
			global: null,
		});
		renderWithAuth(<PanelAccent />);
		await waitFor(() =>
			expect(
				document.documentElement.style.getPropertyValue("--panel-accent"),
			).toBe("#12ab34"),
		);
	});

	it("lets an admin set the accent for everyone, which then wins over a user's own", async () => {
		const user = userEvent.setup();
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
			panel_accent: { mode: "custom", color: "#12ab34" },
		});
		vi.spyOn(PlatformAPI, "getPanelAccentGlobal").mockResolvedValue({
			global: null,
		});
		const saveGlobal = vi
			.spyOn(PlatformAPI, "setPanelAccentGlobal")
			.mockImplementation(async (global) => ({ global }));
		renderWithAuth(
			<>
				<PanelAccentSection />
				<PanelAccent />
			</>,
		);
		await user.click(await screen.findByRole("switch", { name: "Global" }));
		await waitFor(() =>
			expect(saveGlobal).toHaveBeenCalledWith({
				mode: "custom",
				color: "#12ab34",
			}),
		);
	});

	it("draws the panels larger as the size slider says", async () => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
			panel_scale: 125,
		});
		vi.spyOn(PlatformAPI, "getPanelAccentGlobal").mockResolvedValue({
			global: null,
		});
		renderWithAuth(<PanelAccent />);
		await waitFor(() =>
			expect(
				document.documentElement.style.getPropertyValue("--panel-zoom"),
			).toBe("1.25"),
		);
		document.documentElement.style.removeProperty("--panel-zoom");
	});

	it("sets the text colour from a click on the preview's text", async () => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		vi.spyOn(PlatformAPI, "getPanelAccentGlobal").mockResolvedValue({
			global: null,
		});
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => changes);
		renderWithAuth(<PanelAccentSection />);
		const preview = await screen.findByRole("button", {
			name: /Panel preview/,
		});
		await userEvent.click(within(preview).getByText("Workspaces"));
		fireEvent.change(await screen.findByLabelText("Text colour picker"), {
			target: { value: "#ff0000" },
		});
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({ panel_text_color: "#ff0000" }),
		);
	});

	it("sets the card panels' colour, and the panels take it", async () => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		vi.spyOn(PlatformAPI, "getPanelAccentGlobal").mockResolvedValue({
			global: null,
		});
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => changes);
		renderWithAuth(<PanelAccentSection />);
		await userEvent.click(
			await screen.findByRole("combobox", { name: "Card panels" }),
		);
		await userEvent.click(
			screen.getByRole("option", { name: "Custom colour" }),
		);
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({ panel_card_color: "#e4e7eb" }),
		);
	});
});
