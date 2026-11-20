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

	it.each([
		["backdrop", "Backdrop"],
		["surface", "Front panel"],
		["button", "Panel buttons"],
		["container", "Inner container"],
		["border", "Panel borders"],
		["text", "Panel text"],
		["icon", "Panel icons"],
		["track", "Graph tracks"],
		["cpu", "CPU bars"],
		["memory", "Memory bars"],
		["net", "NET bars"],
		["disk", "DISK bars"],
	])("saves the selected %s colour for everyone", async (part, name) => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		vi.spyOn(PlatformAPI, "getPanelAccentGlobal").mockResolvedValue({
			global: null,
			colors: {},
		});
		const save = vi
			.spyOn(PlatformAPI, "setPanelColors")
			.mockImplementation(async (colors) => ({ global: null, colors }));
		const savePersonal = vi.spyOn(PlatformAPI, "setUserUIPreferences");
		renderWithAuth(<PanelAccentSection />);
		const preview = within(
			await screen.findByRole("group", { name: "Panel preview" }),
		);
		const [target] = await preview.findAllByRole("button", {
			name: `Edit ${name.toLowerCase()} colour`,
		});
		await userEvent.click(target);
		fireEvent.change(await preview.findByLabelText(`${name} colour picker`), {
			target: { value: "#ff0000" },
		});
		expect(save).not.toHaveBeenCalled();
		await userEvent.click(
			preview.getByRole("button", { name: "Save for everyone" }),
		);
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({ [part]: "#ff0000" }),
		);
		expect(savePersonal).not.toHaveBeenCalled();
	});

	it("applies saved global overrides ahead of personal colours", async () => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
			panel_text_color: "#000000",
			panel_card_color: "#111111",
		});
		vi.spyOn(PlatformAPI, "getPanelAccentGlobal").mockResolvedValue({
			global: null,
			colors: {
				backdrop: "#123456",
				text: "#ff0000",
				track: "#234567",
				cpu: "#345678",
			},
		});
		renderWithAuth(<PanelAccent />);
		await waitFor(() => {
			const style = document.documentElement.style;
			expect(style.getPropertyValue("--dashboard-panel-bg")).toBe("#123456");
			expect(style.getPropertyValue("--panel-text-primary")).toBe("0 100% 50%");
			expect(style.getPropertyValue("--panel-color-track")).toBe("#234567");
			expect(style.getPropertyValue("--panel-color-cpu")).toBe("#345678");
		});
	});

	it("clears only the selected override", async () => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		vi.spyOn(PlatformAPI, "getPanelAccentGlobal").mockResolvedValue({
			global: null,
			colors: { cpu: "#223344", memory: "#445566" },
		});
		const save = vi
			.spyOn(PlatformAPI, "setPanelColors")
			.mockImplementation(async (colors) => ({ global: null, colors }));
		renderWithAuth(<PanelAccentSection />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Edit cpu bars colour" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Reset colour" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Save for everyone" }),
		);
		await waitFor(() => expect(save).toHaveBeenCalledWith({ cpu: null }));
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
