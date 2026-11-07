import type { BannerEffect } from "#/api/platform";

/** The text effects' names and what each looks like. */
export const EFFECT_OPTIONS: Record<
	BannerEffect,
	{ label: string; hint: string }
> = {
	none: { label: "None", hint: "Plain text, no animation." },
	typewriter: {
		label: "Typewriter",
		hint: "Letters appear one by one, as if typed.",
	},
	fade: { label: "Fade in", hint: "Words fade in one after another." },
	rise: { label: "Rise", hint: "Letters slide up into place." },
	wave: { label: "Wave", hint: "A wave of movement runs through the letters." },
	bounce: { label: "Bounce", hint: "Letters drop in and bounce." },
	flip: { label: "Flip", hint: "Letters flip into view." },
	shake: {
		label: "Shake",
		hint: "The whole message shakes: best kept for urgent notices.",
	},
	pulse: { label: "Pulse", hint: "The message gently pulses." },
	rainbow: { label: "Rainbow", hint: "Colours sweep through the letters." },
	starwars: {
		label: "Star Wars crawl",
		hint: "The message rises from the bottom of the banner to its top at a steady pace, within the banner as it stands, for long broadcasts; its convergence tilts the lines away like the opening crawl, or keeps them a flat scroller. Developers can also read it at once in the banner's scroll-down view.",
	},
	pewpew: {
		label: "Pew-Pew",
		hint: "Each letter fires in as a laser bolt, flashes white on impact with a spark, recoils and settles into a faint glow.",
	},
	flap: {
		label: "Split-Flap",
		hint: "A departure board: every letter on its own plate, flipping over.",
	},
	shimmer: {
		label: "Ghostwrite",
		hint: "Muted letters with a soft band of light sweeping across them.",
	},
	kitt: {
		label: "Knight Rider",
		hint: "KITT's scanner: a red light sweeps back and forth across the banner, its trail fading behind it.",
	},
	aurora: {
		label: "Borealis",
		hint: "An aurora gradient drifts through the letters.",
	},
	neon: { label: "Neon-Haus", hint: "A neon glow flickers like a tube sign." },
	chrome: {
		label: "Chrome",
		hint: "A metallic highlight sweeps over the message.",
	},
	focus: { label: "Lens-Drift", hint: "Letters slip in and out of focus." },
	ember: {
		label: "Emberglow",
		hint: "Warm firelight glows behind the letters.",
	},
	spectrum: {
		label: "Prisma",
		hint: "Each letter refracts a changing spectrum.",
	},
	anaglyph: {
		label: "Anaglyph-3D",
		hint: "Red and cyan shadows drift apart and return.",
	},
	heartbeat: {
		label: "Cardio",
		hint: "A double heartbeat pulses with a glow.",
	},
	softblur: {
		label: "Soft-Blur",
		hint: "The message breathes between crisp and hazy.",
	},
	voltage: {
		label: "Kilovolt",
		hint: "Letters crackle with staggered electric flashes.",
	},
	gold: {
		label: "Gold Foil",
		hint: "Liquid gold shimmers through the letters.",
	},
	hologram: {
		label: "Hologram",
		hint: "A cyan projection hovers and flickers.",
	},
	vaporwave: {
		label: "Vaporwave",
		hint: "Pink and cyan ghosts drift around the letters.",
	},
	slam: {
		label: "Slam",
		hint: "The message crashes in, big and blurred, and settles.",
	},
	terminal: {
		label: "Terminal",
		hint: "Green phosphor text with scanlines and flicker.",
	},
	prism: {
		label: "Prism Split",
		hint: "Red and cyan edges pull apart and back.",
	},
	sparkle: {
		label: "Sparkle",
		hint: "Stars twinkle across a shimmering fill.",
	},
	frost: {
		label: "Frost",
		hint: "Icy letters with glittering frost.",
	},
	longshadow: {
		label: "Sundial",
		hint: "A long shadow circles the letters like a sundial.",
	},
	retro: {
		label: "Groovy",
		hint: "Seventies layered shadows breathe in and out.",
	},
	popart: {
		label: "Pop Art",
		hint: "Letters hop one after another over a comic shadow.",
	},
	glitch: {
		label: "Glitch",
		hint: "Colour channels tear apart in brief digital faults.",
	},
	elastic: {
		label: "Rubber Band",
		hint: "The message stretches and snaps back.",
	},
	pendulum: {
		label: "Pendulum",
		hint: "Letters swing like hanging signs.",
	},
	stretch: {
		label: "Stretch",
		hint: "Letters grow tall one after another.",
	},
	jitter: {
		label: "Jitter",
		hint: "Brief nervous shakes and skews.",
	},
	iridescent: {
		label: "Iridescent",
		hint: "Oil-slick colours roll through the letters.",
	},
	motionblur: {
		label: "Speed Smear",
		hint: "Letters streak in and out with motion blur.",
	},
	karaoke: {
		label: "Karaoke",
		hint: "Letters light up one by one, like lyrics.",
	},
	marker: {
		label: "Highlighter",
		hint: "A marker stroke sweeps behind the message.",
	},
	loud: {
		label: "Shout",
		hint: "The message swells and shakes, then settles.",
	},
	duotone: {
		label: "Duotone",
		hint: "Two coloured shadows slide apart and back.",
	},
};
