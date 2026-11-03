import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * The user menu's Animations (on by default, remembered in this browser): one
 * switch for all of them, and one for each part, for a browser short on
 * processing power:
 *   - effects: every CSS animation and transition in the dashboard ends at once
 *     (menus, fades, the agent cards' animated borders, the announcement's
 *     effects, the Cloud Drive's cables at rest, ...); loading spinners still
 *     turn. <html data-animations="on|off"> carries it for CSS;
 *   - gifs: animated GIFs anywhere (logo, avatars, the initializing animation,
 *     ...) stand still on their first frame (AnimationsController);
 *   - background: the page backgrounds' animations (particles and the like)
 *     stand still;
 *   - announcement: announcement text, scrolling and pictures stand still.
 * The live metric graphs are the fourth part (metricGraphSettings: Metrics
 * Interval's "off"). All off overrides every part, without forgetting them.
 */
export const ANIMATION_LABELS = [
	{ part: "all", label: "All animations" },
	{ part: "effects", label: "Effects & transitions" },
	{ part: "gifs", label: "Animated GIFs" },
	{ part: "graphs", label: "Live graphs" },
	{ part: "background", label: "Moving background" },
	{ part: "announcement", label: "Announcement animations" },
] as const;
export const DEFAULT_ANIMATION_POLICY = {
	all: true,
	effects: true,
	gifs: true,
	graphs: true,
	background: true,
	announcement: true,
};
export const AnimationPolicyContext = createContext(
	window.__cuiAnimationPolicy ?? DEFAULT_ANIMATION_POLICY,
);
export const useAnimationPolicy = () => useContext(AnimationPolicyContext);

const KEY = "coder-ui-animations";
const PARTS_KEY = "coder-ui-animations-parts";
const CHANGE = "coder-ui-animations-change";

export type AnimationPart = "effects" | "gifs" | "background" | "announcement";
export const ANIMATION_PARTS: readonly AnimationPart[] = [
	"effects",
	"gifs",
	"background",
	"announcement",
];

export type AnimationSettings = {
	/** The switch for all of them. */
	all: boolean;
} & Record<AnimationPart, boolean>;

const read = (): AnimationSettings => {
	const settings: AnimationSettings = {
		all: true,
		effects: true,
		gifs: true,
		background: true,
		announcement: true,
	};
	try {
		settings.all = localStorage.getItem(KEY) !== "0";
		const parts = JSON.parse(localStorage.getItem(PARTS_KEY) ?? "{}");
		for (const part of ANIMATION_PARTS) {
			if (typeof parts?.[part] === "boolean") {
				settings[part] = parts[part];
			}
		}
	} catch {
		// The defaults.
	}
	return settings;
};

export const readAnimationsEnabled = (): boolean => read().all;

let settings = read();

const changed = (next: AnimationSettings) => {
	settings = next;
	try {
		localStorage.setItem(KEY, next.all ? "1" : "0");
		localStorage.setItem(
			PARTS_KEY,
			JSON.stringify(
				Object.fromEntries(ANIMATION_PARTS.map((part) => [part, next[part]])),
			),
		);
	} catch {
		// For this page only.
	}
	window.dispatchEvent(new CustomEvent(CHANGE));
};

export const setAnimationsEnabled = (enabled: boolean) =>
	changed({ ...settings, all: enabled });

export const setAnimationPart = (part: AnimationPart, enabled: boolean) =>
	changed({ ...settings, [part]: enabled });

const subscribe = (onChange: () => void) => {
	const onStorage = (event: StorageEvent) => {
		if (event.key === KEY || event.key === PARTS_KEY) {
			settings = read();
			onChange();
		}
	};
	window.addEventListener(CHANGE, onChange);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(CHANGE, onChange);
		window.removeEventListener("storage", onStorage);
	};
};

/** The switches as set (a part may be on while all are off). */
export const useAnimationSettings = (): AnimationSettings => {
	const policy = useAnimationPolicy();
	const personal = useSyncExternalStore(
		subscribe,
		() => settings,
		() => settings,
	);

	return {
		all: personal.all && policy.all,
		effects: personal.effects && policy.effects,
		gifs: personal.gifs && policy.gifs,
		background: personal.background && policy.background,
		announcement: personal.announcement && policy.announcement,
	};
};

/** Whether a part moves now: all on, and that part on. */
export const animated = (s: AnimationSettings, part: AnimationPart) =>
	s.all && s[part];

/** Motion effects (animations, transitions, the cables' physics) are on. */
export const useAnimationsEnabled = (): boolean =>
	animated(useAnimationSettings(), "effects");

/** The page backgrounds move. */
export const useBackgroundAnimated = (): boolean =>
	animated(useAnimationSettings(), "background");
