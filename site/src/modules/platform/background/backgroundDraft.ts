import type {
	BackgroundDials,
	BackgroundFit,
	BackgroundLayer,
	BackgroundParams,
	BackgroundSlot,
	BackgroundsState,
} from "#/api/platform";
import { type LavaSettings, lavaSettings } from "#/components/LavaImage/lava";
import { type FillSettings, fillSettings } from "../fill/fill";
import type { HtmlSource } from "./HtmlBackgroundControls";
import { type ParticlesSettings, particlesSettings } from "./particles";
export const SLOT_TEXT: Record<
	BackgroundSlot,
	{ title: string; hint: string }
> = {
	login: {
		title: "Sign-in page",
		hint: "Behind the sign-in form, for everyone, before they sign in.",
	},
	dashboard: {
		title: "Dashboard",
		hint: "Behind every page once signed in.",
	},
};

export const FITS: { value: BackgroundFit; label: string }[] = [
	{ value: "cover", label: "Fill the window" },
	{ value: "contain", label: "Fit inside" },
	{ value: "tile", label: "Tile" },
	{ value: "stretch", label: "Stretch" },
	{ value: "center", label: "Center" },
	{ value: "span", label: "Span" },
];

export type Draft = {
	removed?: boolean;
	/** A picture, the Particles or Lava lamp preset, or HTML of one's own. */
	source: "image" | "fill" | HtmlSource;
	fill: FillSettings;
	dataURL?: string;
	/** One of the dashboard's own pictures, by its path: saved as that, not uploaded. */
	picture?: string;
	name?: string;
	bytes?: number;
	html?: string;
	particles: ParticlesSettings;
	lava: LavaSettings;
	dials: BackgroundDials;
	opacity: number;
	fit: BackgroundFit;
	layer: BackgroundLayer;
	/** Something differs from what is saved. */
	dirty: boolean;
};

const DIAL_KEYS = ["speed", "hue", "saturation", "brightness", "blur"] as const;
const dialsOf = (params: BackgroundParams | undefined): BackgroundDials => {
	const out: BackgroundDials = {};
	for (const key of DIAL_KEYS) {
		if (typeof params?.[key] === "number") {
			out[key] = params[key];
		}
	}
	return out;
};

export const backgroundDraft = (
	current: BackgroundsState[BackgroundSlot],
	defaultOpacity: number,
): Draft => {
	const preset = current?.params?.preset;
	return {
		source:
			current?.kind !== "html"
				? "image"
				: preset?.name === "particles"
					? "particles"
					: preset?.name === "fill"
						? "fill"
						: preset?.name === "lava"
							? "lava"
							: "custom",
		html: undefined,
		fill: fillSettings(preset),
		particles: particlesSettings(preset),
		lava: lavaSettings(preset?.name === "lava" ? preset : undefined),
		dials: dialsOf(current?.params),
		opacity: current?.opacity ?? defaultOpacity,
		// The lava lamp draws its own fit, kept with its settings.
		fit:
			(preset?.name === "lava" &&
				FITS.find((f) => f.value === preset.fit)?.value) ||
			(current?.fit ?? "cover"),
		layer: current?.layer ?? "under",
		dirty: false,
	};
};
