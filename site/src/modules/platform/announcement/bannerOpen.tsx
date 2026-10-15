import { useEffect, useState } from "react";
import type { BannerOpenEffect } from "#/api/platform";
import { KittSweep, motionOff } from "./bannerClose";
import "./bannerOpen.css";

/** The open transitions, as the editor offers them. */
export const OPEN_EFFECT_OPTIONS: Record<
	BannerOpenEffect,
	{ label: string; hint: string }
> = {
	none: { label: "None", hint: "It is simply there." },
	fade: { label: "Fade in", hint: "It fades in." },
	rolldown: { label: "Roll down", hint: "It rolls down like a blind." },
	kitt: {
		label: "Knight Rider",
		hint: "KITT's scanner: the red light runs across and lights it up behind it, comes back, and the lamps go out.",
	},
	crt: {
		label: "TV switch-on",
		hint: "An old tube set switched on: a dot of light opens into a line, the line into the banner.",
	},
	glitch: {
		label: "Glitch",
		hint: "It glitches into place: slices, jitter and split colours, then it settles.",
	},
};

/** The longest transition, and a little more: the banner is as usual then even if no animation ends. */
const OPEN_FALLBACK_MS = 1600;

/**
 * Plays the banner's open transition (bannerOpen.css) on the element given
 * `props` when it first appears (a new announcement remounts the banner); none
 * for "none", or without motion.
 */
export const useOpenTransition = (effect: BannerOpenEffect) => {
	const [opening, setOpening] = useState(
		() => effect !== "none" && !motionOff(),
	);
	useEffect(() => {
		if (!opening) {
			return;
		}
		const timer = window.setTimeout(() => setOpening(false), OPEN_FALLBACK_MS);
		return () => window.clearTimeout(timer);
	}, [opening]);
	return {
		opening,
		props: {
			"data-opening": opening ? effect : undefined,
			onAnimationEnd: (event: React.AnimationEvent<HTMLElement>) => {
				if (
					opening &&
					event.target === event.currentTarget &&
					event.animationName.startsWith("banner-open-")
				) {
					setOpening(false);
				}
			},
		},
	};
};

/** What a transition draws besides the banner itself: Knight Rider's scanner. Inside the banner, while it opens. */
export const OpenLayers: React.FC<{ effect: BannerOpenEffect }> = ({
	effect,
}) => (effect === "kitt" ? <KittSweep phase="open" /> : null);
