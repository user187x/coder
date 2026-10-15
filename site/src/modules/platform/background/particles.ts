/**
 * The "Particles" background (built in, animated): particles over a colour or
 * a gradient, from example.html (its glowing orbs circling slowly are the
 * defaults). Its dials: the background (solid, vertical or radial, with a
 * second colour), the three particle colours, their shape (soft orbs, dots,
 * bubbles, squares, pixel blocks, diamonds, sparks), how they move (orbit,
 * drift, rise, fall, twinkle; tumbling or not), how many, how big and how
 * varied, how opaque, how far each one's glow sits from it and how soft it is,
 * whether they blend luminously, and a shuffle of their places. Speed and the
 * colour filters are the dials every HTML background has (backgroundHtml.ts).
 * PARTICLE_THEMES are ready-made settings.
 */
export const PARTICLE_SHAPES = [
	"orb",
	"dot",
	"bubble",
	"square",
	"block",
	"diamond",
	"spark",
] as const;
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];

export const PARTICLE_MOTIONS = [
	"orbit",
	"drift",
	"rise",
	"fall",
	"twinkle",
] as const;
export type ParticleMotion = (typeof PARTICLE_MOTIONS)[number];

export const BACKGROUND_STYLES = ["solid", "vertical", "radial"] as const;
export type BackgroundStyle = (typeof BACKGROUND_STYLES)[number];

export type ParticlesSettings = {
	name: "particles";
	background: string;
	/** The gradient's other colour: the bottom of a vertical one, the middle of a radial one. */
	background2: string;
	backgroundStyle: BackgroundStyle;
	colors: [string, string, string];
	shape: ParticleShape;
	motion: ParticleMotion;
	/** Each particle turns about itself as it moves (orbiting ones always do). */
	tumble: boolean;
	count: number;
	size: number;
	/** 0: all the same size; 1: from a quarter to nearly twice as big. */
	variation: number;
	opacity: number;
	spread: number;
	glow: number;
	/** Luminous: overlapping particles brighten each other (screen blending). */
	screen: boolean;
	/** 0: example.html's places; any other: other places, the same everywhere for the same number. */
	seed: number;
};

export const PARTICLES_DEFAULT: ParticlesSettings = {
	name: "particles",
	background: "#3E1E68",
	background2: "#1B0B33",
	backgroundStyle: "solid",
	colors: ["#583C87", "#E45A84", "#FFACAC"],
	shape: "orb",
	motion: "orbit",
	tumble: false,
	count: 20,
	size: 20,
	variation: 0,
	opacity: 1,
	spread: 40,
	glow: 1,
	screen: false,
	seed: 0,
};

export const PARTICLES_LIMITS = {
	count: { min: 1, max: 60, step: 1 },
	size: { min: 1, max: 40, step: 0.5 },
	variation: { min: 0, max: 1, step: 0.05 },
	opacity: { min: 0.1, max: 1, step: 0.05 },
	spread: { min: 0, max: 80, step: 1 },
	glow: { min: 0, max: 3, step: 0.05 },
	seed: { min: 0, max: 999, step: 1 },
} as const;

export type ParticleTheme = {
	id: string;
	name: string;
	description: string;
	settings: ParticlesSettings;
};

const theme = (
	id: string,
	name: string,
	description: string,
	settings: Partial<ParticlesSettings>,
): ParticleTheme => ({
	id,
	name,
	description,
	settings: { ...PARTICLES_DEFAULT, ...settings },
});

/** Ready-made settings, each a starting point for the dials. */
export const PARTICLE_THEMES: readonly ParticleTheme[] = [
	theme(
		"original",
		"Original",
		"Glowing orbs circling slowly over violet (example.html).",
		{},
	),
	theme(
		"aurora",
		"Aurora",
		"Teal, green and violet light wheeling over a polar night.",
		{
			background: "#03121B",
			background2: "#0B3B38",
			backgroundStyle: "vertical",
			colors: ["#2DD4BF", "#22C55E", "#A78BFA"],
			count: 24,
			size: 22,
			spread: 34,
			glow: 1.4,
			opacity: 0.85,
			screen: true,
		},
	),
	theme("fireflies", "Fireflies", "Warm specks pulsing in a summer dusk.", {
		background: "#070F06",
		background2: "#1C2A12",
		backgroundStyle: "radial",
		colors: ["#EAFF7B", "#C6F432", "#FFE58A"],
		shape: "dot",
		motion: "twinkle",
		count: 42,
		size: 1.5,
		variation: 0.5,
		spread: 0,
		glow: 2.4,
		screen: true,
		seed: 7,
	}),
	theme(
		"snowfall",
		"Snowfall",
		"Soft flakes drifting down a winter night sky.",
		{
			background: "#0A1830",
			background2: "#29476F",
			backgroundStyle: "vertical",
			colors: ["#FFFFFF", "#DBEAFE", "#BFDBFE"],
			shape: "dot",
			motion: "fall",
			count: 55,
			size: 1.2,
			variation: 0.6,
			opacity: 0.9,
			spread: 0,
			glow: 1.2,
			seed: 11,
		},
	),
	theme(
		"synthwave",
		"Synthwave",
		"Neon diamonds wheeling over a dusk of purple.",
		{
			background: "#12002B",
			background2: "#3D0A5C",
			backgroundStyle: "vertical",
			colors: ["#FF2FD6", "#22E5FF", "#FFD23F"],
			shape: "diamond",
			count: 18,
			size: 5,
			variation: 0.3,
			spread: 12,
			glow: 1.6,
			screen: true,
			seed: 3,
		},
	),
	theme(
		"minecraft-overworld",
		"Minecraft: Overworld",
		"Grass, dirt and stone blocks tumbling through a clear blue sky.",
		{
			background: "#78A9FF",
			background2: "#CDE6FF",
			backgroundStyle: "vertical",
			colors: ["#5B8C32", "#866043", "#8F8F8F"],
			shape: "block",
			motion: "drift",
			tumble: true,
			count: 22,
			size: 6,
			variation: 0.35,
			spread: 0,
			glow: 0,
			seed: 42,
		},
	),
	theme(
		"minecraft-nether",
		"Minecraft: Nether",
		"Lava, glowstone and netherrack embers rising through the Nether's haze.",
		{
			background: "#1A0505",
			background2: "#4A0F0F",
			backgroundStyle: "radial",
			colors: ["#FF6A00", "#FFD24A", "#7A1F1F"],
			shape: "block",
			motion: "rise",
			tumble: true,
			count: 40,
			size: 1.8,
			variation: 0.6,
			spread: 0,
			glow: 1.5,
			screen: true,
			seed: 66,
		},
	),
	theme(
		"minecraft-xp",
		"Minecraft: XP orbs",
		"Green and gold experience orbs pulsing in the dark.",
		{
			background: "#060C18",
			background2: "#10233B",
			backgroundStyle: "radial",
			colors: ["#B6FF3B", "#E6FF57", "#6CFF4E"],
			shape: "dot",
			motion: "twinkle",
			count: 30,
			size: 2.4,
			variation: 0.4,
			spread: 0,
			glow: 2,
			screen: true,
			seed: 9,
		},
	),
];

/** The theme these settings are exactly, if any. */
export const particleThemeOf = (
	settings: ParticlesSettings,
): ParticleTheme | undefined => {
	const key = JSON.stringify(particlesSettings(settings));
	return PARTICLE_THEMES.find((t) => JSON.stringify(t.settings) === key);
};

type Seed = [number, number, number, number, number, number, number, 1 | -1];

// example.html's twenty particles: top %, left %, duration s, delay s,
// transform-origin (vw, vh), glow blur (vmin) and glow side.
const SEEDS: Seed[] = [
	[12, 45, 15, -5, -12, 15, 8.5, 1],
	[67, 89, 12, -11, 22, -10, 12.1, -1],
	[34, 12, 14, -3, -5, -20, 7, 1],
	[88, 56, 11, -15, 18, 23, 14, -1],
	[45, 77, 13, -7, -21, 8, 11, 1],
	[11, 23, 16, -1, 5, -15, 9, -1],
	[92, 18, 10.5, -9, 24, 11, 10, 1],
	[31, 66, 14.5, -14, -11, -6, 6, -1],
	[76, 41, 11.8, -4, 15, 19, 13, 1],
	[5, 91, 15.2, -12, -8, -22, 8, -1],
	[54, 11, 12.3, -8, 21, 4, 11.5, 1],
	[22, 81, 13.7, -10, -19, 16, 9.5, -1],
	[61, 34, 10.9, -6, 12, -13, 14.2, 1],
	[83, 6, 14.1, -13, -24, 21, 5.5, -1],
	[15, 59, 11.4, -2, 8, -9, 12.8, 1],
	[48, 94, 15.6, -15.5, 20, 18, 7.2, -1],
	[71, 27, 13.2, -5.5, -14, -17, 10.3, 1],
	[39, 48, 10.3, -11.5, 17, 7, 14.8, -1],
	[97, 72, 14.8, -1.5, -6, 24, 6.4, 1],
	[8, 16, 12.6, -9.5, 11, -11, 11.9, -1],
];

/** A particle placed the same way, from a fixed seed (so a saved one looks the same everywhere). */
const extra = (i: number): Seed => {
	let x = Math.imul(i + 1, 0x9e3779b1);
	const next = () => {
		x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
		x ^= x >>> 13;
		return ((x >>> 0) % 10000) / 10000;
	};
	return [
		Math.round(next() * 100),
		Math.round(next() * 100),
		Math.round((10 + next() * 6) * 10) / 10,
		-Math.round(next() * 160) / 10,
		Math.round((next() * 48 - 24) * 10) / 10,
		Math.round((next() * 48 - 24) * 10) / 10,
		Math.round((5 + next() * 10) * 10) / 10,
		i % 2 ? -1 : 1,
	];
};

/** Particle i's place: example.html's twenty, then more; another layout for another seed. */
const seedOf = (i: number, seed: number): Seed =>
	seed === 0 ? (i < SEEDS.length ? SEEDS[i] : extra(i)) : extra(i + seed * 97);

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const color = (value: unknown, fallback: string) =>
	typeof value === "string" && HEX.test(value) ? value : fallback;
const number = (value: unknown, fallback: number, min: number, max: number) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
const oneOf = <T extends string>(
	value: unknown,
	options: readonly T[],
	fallback: T,
): T => options.find((o) => o === value) ?? fallback;

/** Settings read back from storage: anything missing or out of bounds is the default. */
export const particlesSettings = (value: unknown): ParticlesSettings => {
	const v = (value && typeof value === "object" ? value : {}) as Record<
		string,
		unknown
	>;
	const colors = Array.isArray(v.colors) ? v.colors : [];
	const d = PARTICLES_DEFAULT;
	const L = PARTICLES_LIMITS;
	return {
		name: "particles",
		background: color(v.background, d.background),
		background2: color(v.background2, d.background2),
		backgroundStyle: oneOf(
			v.backgroundStyle,
			BACKGROUND_STYLES,
			d.backgroundStyle,
		),
		colors: [
			color(colors[0], d.colors[0]),
			color(colors[1], d.colors[1]),
			color(colors[2], d.colors[2]),
		],
		shape: oneOf(v.shape, PARTICLE_SHAPES, d.shape),
		motion: oneOf(v.motion, PARTICLE_MOTIONS, d.motion),
		tumble: typeof v.tumble === "boolean" ? v.tumble : d.tumble,
		count: Math.round(number(v.count, d.count, L.count.min, L.count.max)),
		size: number(v.size, d.size, L.size.min, L.size.max),
		variation: number(
			v.variation,
			d.variation,
			L.variation.min,
			L.variation.max,
		),
		opacity: number(v.opacity, d.opacity, L.opacity.min, L.opacity.max),
		spread: number(v.spread, d.spread, L.spread.min, L.spread.max),
		glow: number(v.glow, d.glow, L.glow.min, L.glow.max),
		screen: typeof v.screen === "boolean" ? v.screen : d.screen,
		seed: Math.round(number(v.seed, d.seed, L.seed.min, L.seed.max)),
	};
};

const round = (n: number) => Math.round(n * 100) / 100;

/** The page's background: a colour, or a vertical or radial gradient to the second colour. */
const backgroundOf = (s: ParticlesSettings) =>
	s.backgroundStyle === "vertical"
		? `linear-gradient(180deg, ${s.background}, ${s.background2})`
		: s.backgroundStyle === "radial"
			? `radial-gradient(ellipse at 50% 45%, ${s.background2}, ${s.background} 75%)`
			: s.background;

/** Shapes drawn with a clipped ::before (their glow a drop-shadow filter, which clipping would cut off). */
const CLIPS: Partial<Record<ParticleShape, string>> = {
	diamond: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
	spark:
		"polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%)",
};

/** The shape's own rules, beyond the orb's (a box whose glow alone shows, away from it). */
const shapeRules = (s: ParticlesSettings): string[] => {
	switch (s.shape) {
		case "orb":
			return [];
		case "dot":
			return [
				".background span { border-radius: 50%; background: currentColor; }",
			];
		case "bubble":
			return [
				`.background span { border-radius: 50%; box-sizing: border-box; border: max(1px, ${round(s.size * 0.12)}vmin) solid currentColor; }`,
			];
		case "square":
			return [
				`.background span { border-radius: ${round(s.size * 0.18)}vmin; background: currentColor; }`,
			];
		case "block":
			// A pixel-art block: its colour, a grain of squares over it, lit from the top left.
			return [
				".background span { border-radius: 0; background-color: currentColor; background-image: repeating-conic-gradient(rgb(0 0 0 / 0.14) 0 25%, rgb(255 255 255 / 0.07) 0 50%); background-size: 50% 50%; }",
			];
		case "diamond":
		case "spark":
			return [
				".background span { border-radius: 0; }",
				`.background span::before { content: ""; position: absolute; inset: 0; background: currentColor; clip-path: ${CLIPS[s.shape]}; }`,
			];
	}
};

/** The keyframes of the motion: where a particle goes, turning (tumble) or not. */
const motionKeyframes = (s: ParticlesSettings): string => {
	if (s.motion === "orbit") {
		return "@keyframes move { 100% { transform: translate3d(0, 0, 1px) rotate(360deg); } }";
	}
	const turn = s.tumble ? 360 : 0;
	const at = (x: string, y: string, part: number) =>
		`transform: translate3d(${x}, ${y}, 1px) rotate(${round(turn * part)}deg);`;
	switch (s.motion) {
		case "drift":
			return `@keyframes move { 0% { ${at("0", "0", 0)} } 25% { ${at("4vw", "-3vh", 0.25)} } 50% { ${at("0", "-6vh", 0.5)} } 75% { ${at("-4vw", "-3vh", 0.75)} } 100% { ${at("0", "0", 1)} } }`;
		case "rise":
			return `@keyframes move { 0% { ${at("0", "10vh", 0)} } 25% { ${at("3vw", "-30vh", 0.25)} } 50% { ${at("0", "-70vh", 0.5)} } 75% { ${at("-3vw", "-110vh", 0.75)} } 100% { ${at("0", "-150vh", 1)} } }`;
		case "fall":
			return `@keyframes move { 0% { ${at("0", "-50vh", 0)} } 25% { ${at("3vw", "-8vh", 0.25)} } 50% { ${at("0", "34vh", 0.5)} } 75% { ${at("-3vw", "76vh", 0.75)} } 100% { ${at("0", "118vh", 1)} } }`;
		case "twinkle": {
			const lo = round(s.opacity * 0.15);
			return `@keyframes move { 0% { opacity: ${lo}; transform: translate3d(0, 0, 1px) scale(0.55) rotate(0deg); } 50% { opacity: ${s.opacity}; transform: translate3d(0, 0, 1px) scale(1) rotate(${turn / 2}deg); } 100% { opacity: ${lo}; transform: translate3d(0, 0, 1px) scale(0.55) rotate(${turn}deg); } }`;
		}
	}
};

/** A particle's size factor (variation): from a quarter to 1.75, the same for the same particle. */
const sizeFactor = (i: number, seed: Seed, variation: number) => {
	const r = (((seed[0] * 37 + seed[1] * 11 + i * 7) % 100) / 50 - 1) * 0.75;
	return 1 + variation * r;
};

/** The Particles page: example.html with the settings filled in (the defaults give example.html itself). */
export const particlesHTML = (settings: ParticlesSettings): string => {
	const s = particlesSettings(settings);
	const clipped = Boolean(CLIPS[s.shape]);
	const rows: string[] = [];
	for (let i = 0; i < s.count; i++) {
		const seed = seedOf(i, s.seed);
		const [top, left, duration, delay, ox, oy, blur, side] = seed;
		const glow = Math.round(blur * s.glow * 100) / 100;
		const offset = side * s.spread;
		const decl: string[] = [`color: ${s.colors[i % 3]}`];
		if (s.motion === "orbit") {
			decl.push(
				`top: ${top}%`,
				`left: ${left}%`,
				`animation-duration: ${duration}s`,
				`animation-delay: ${delay}s`,
				`transform-origin: ${ox}vw ${oy}vh`,
			);
		} else if (s.motion === "rise" || s.motion === "fall") {
			// Spread over the whole way at once: each starts as far along as its place says.
			const slow = round(duration * 1.4);
			decl.push(
				`top: ${s.motion === "rise" ? 100 : 0}%`,
				`left: ${left}%`,
				`animation-duration: ${slow}s`,
				`animation-delay: ${round((-slow * top) / 100)}s`,
			);
		} else {
			const pace = s.motion === "twinkle" ? round(duration * 0.4) : duration;
			decl.push(
				`top: ${top}%`,
				`left: ${left}%`,
				`animation-duration: ${pace}s`,
				`animation-delay: ${round((delay * pace) / duration)}s`,
			);
		}
		const factor = sizeFactor(i, seed, s.variation);
		const size = round(s.size * factor);
		if (s.variation > 0) {
			decl.push(`width: ${size}vmin`, `height: ${size}vmin`);
			if (s.shape === "orb") {
				decl.push(`border-radius: ${size}vmin`);
			}
		}
		const blurOf = s.variation > 0 ? round(glow * factor) : glow;
		if (clipped) {
			decl.push(
				`filter: drop-shadow(${offset}vmin 0 ${round(blurOf / 2)}vmin currentColor)`,
			);
		} else if (s.shape === "block") {
			const bevel = round(Math.max(0.15, size * 0.12));
			decl.push(
				`box-shadow: inset ${bevel}vmin ${bevel}vmin 0 rgb(255 255 255 / 0.28), inset -${bevel}vmin -${bevel}vmin 0 rgb(0 0 0 / 0.3), ${offset}vmin 0 ${blurOf}vmin currentColor`,
			);
		} else {
			decl.push(`box-shadow: ${offset}vmin 0 ${blurOf}vmin currentColor`);
		}
		rows.push(`.background span:nth-child(${i + 1}) { ${decl.join("; ")}; }`);
	}
	const extras = [
		...shapeRules(s),
		...(s.motion === "drift" || s.motion === "twinkle"
			? [".background span { animation-timing-function: ease-in-out; }"]
			: []),
		...(s.opacity !== 1 && s.motion !== "twinkle"
			? [`.background span { opacity: ${s.opacity}; }`]
			: []),
		...(s.screen ? [".background span { mix-blend-mode: screen; }"] : []),
	];
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Particles</title>
<style>
  body { margin: 0; overflow: hidden; }
  .background { width: 100vw; height: 100vh; background: ${backgroundOf(s)}; }
  .background span {
    width: ${s.size}vmin; height: ${s.size}vmin; border-radius: ${s.size}vmin;
    backface-visibility: hidden; position: absolute;
    animation-name: move; animation-duration: 6s; animation-timing-function: linear; animation-iteration-count: infinite;
  }
  ${[...extras, ...rows].join("\n  ")}
  ${motionKeyframes(s)}
</style>
</head>
<body>
  <div class="background">${"<span></span>".repeat(s.count)}</div>
</body>
</html>
`;
};
