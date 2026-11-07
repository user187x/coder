import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BANNER_EFFECTS, type BannerEffect } from "#/api/platform";
import { EffectGallery } from "./EffectGallery";
import { EFFECT_OPTIONS } from "./effectOptions";

const NEW_EFFECTS: readonly BannerEffect[] = [
	"gold",
	"hologram",
	"vaporwave",
	"slam",
	"terminal",
	"prism",
	"sparkle",
	"frost",
	"longshadow",
	"retro",
	"popart",
	"glitch",
	"elastic",
	"pendulum",
	"stretch",
	"jitter",
	"iridescent",
	"motionblur",
	"karaoke",
	"marker",
	"loud",
	"duotone",
];

describe("EffectGallery", () => {
	it("has a name for every effect, the new ones included", () => {
		for (const effect of BANNER_EFFECTS) {
			expect(EFFECT_OPTIONS[effect].label).not.toBe("");
		}
		for (const effect of NEW_EFFECTS) {
			expect(BANNER_EFFECTS).toContain(effect);
		}
	});

	it.each([
		"typewriter",
		"fade",
		"karaoke",
		"marker",
		"shimmer",
		"pewpew",
		"flap",
	] as const)("shows the whole sample, still, for %s", async (effect) => {
		const user = userEvent.setup();
		render(<EffectGallery value="none" onChange={vi.fn()} />);
		await user.click(screen.getByRole("button", { name: "Text effect" }));
		const tile = screen.getByRole("radio", {
			name: EFFECT_OPTIONS[effect].label,
		});
		expect(tile).toHaveTextContent("Sample");
	});

	it("draws every tile on the banner's screen, as the banner does", async () => {
		const user = userEvent.setup();
		render(<EffectGallery value="none" onChange={vi.fn()} />);
		await user.click(screen.getByRole("button", { name: "Text effect" }));
		const tile = screen.getByRole("radio", { name: "Gold Foil" });
		const stage = within(tile).getByTestId("effect-stage");
		expect(stage).toHaveAttribute("data-announcement-motion");
		const screenEl = within(stage).getByTestId("announcement-lcd");
		expect(screenEl.style.getPropertyValue("--banner-lcd-ink")).not.toBe("");
		expect(
			within(screenEl).getByText("Sample").closest("[data-banner-text]"),
		).toHaveAttribute("data-fx-still");
	});

	it("opens on a button and lists every effect by name, the chosen one checked", async () => {
		const user = userEvent.setup();
		render(<EffectGallery value="gold" onChange={vi.fn()} />);
		expect(screen.queryByRole("radiogroup")).toBeNull();
		await user.click(screen.getByRole("button", { name: "Text effect" }));
		expect(
			screen.getByRole("radiogroup", { name: "Text effect" }),
		).toBeVisible();
		for (const effect of NEW_EFFECTS) {
			expect(
				screen.getByRole("radio", { name: EFFECT_OPTIONS[effect].label }),
			).toBeInTheDocument();
		}
		expect(screen.getByRole("radio", { name: "Gold Foil" })).toBeChecked();
		expect(screen.getByRole("radio", { name: "Glitch" })).not.toBeChecked();
	});

	it("saves the effect that is clicked and closes", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<EffectGallery value="none" onChange={onChange} />);
		await user.click(screen.getByRole("button", { name: "Text effect" }));
		await user.click(screen.getByRole("radio", { name: "Vaporwave" }));
		expect(onChange).toHaveBeenCalledWith("vaporwave");
		expect(screen.queryByRole("radiogroup")).toBeNull();
	});

	it("chooses with the keyboard: arrows move, Enter selects", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<EffectGallery value="none" onChange={onChange} />);
		screen.getByRole("button", { name: "Text effect" }).focus();
		await user.keyboard("{Enter}");
		await user.tab();
		expect(screen.getByRole("radio", { name: "None" })).toHaveFocus();
		await user.keyboard("{ArrowRight}{ArrowRight}");
		expect(screen.getByRole("radio", { name: "Fade in" })).toHaveFocus();
		await user.keyboard("{Enter}");
		expect(onChange).toHaveBeenCalledWith("fade");
	});
});
