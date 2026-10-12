/**
 * The "Particles" background (built in, animated): glowing orbs that circle
 * slowly over a plain colour, from example.html. Its dials: the background and
 * the three particle colours, how many, how big, how far each one's glow sits
 * from it, and how soft that glow is. Speed and the colour filters are the
 * dials every HTML background has (backgroundHtml.ts).
 */
export type ParticlesSettings = {
	name: "particles";
	background: string;
	colors: [string, string, string];
	count: number;
	size: number;
	spread: number;
	glow: number;
};

export const PARTICLES_DEFAULT: ParticlesSettings = {
	name: "particles",
	background: "#3E1E68",
	colors: ["#583C87", "#E45A84", "#FFACAC"],
	count: 20,
	size: 20,
	spread: 40,
	glow: 1,
};

export const PARTICLES_LIMITS = {
	count: { min: 1, max: 60, step: 1 },
	size: { min: 4, max: 40, step: 1 },
	spread: { min: 0, max: 80, step: 1 },
	glow: { min: 0.2, max: 3, step: 0.05 },
} as const;

// example.html's twenty particles: top %, left %, duration s, delay s,
// transform-origin (vw, vh), glow blur (vmin) and glow side.
const SEEDS: [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	1 | -1,
][] = [
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

/** Particles past the twentieth: placed the same way, from a fixed seed (so a saved one looks the same everywhere). */
const extra = (i: number): (typeof SEEDS)[number] => {
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

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const color = (value: unknown, fallback: string) =>
	typeof value === "string" && HEX.test(value) ? value : fallback;
const number = (value: unknown, fallback: number, min: number, max: number) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;

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
		colors: [
			color(colors[0], d.colors[0]),
			color(colors[1], d.colors[1]),
			color(colors[2], d.colors[2]),
		],
		count: Math.round(number(v.count, d.count, L.count.min, L.count.max)),
		size: number(v.size, d.size, L.size.min, L.size.max),
		spread: number(v.spread, d.spread, L.spread.min, L.spread.max),
		glow: number(v.glow, d.glow, L.glow.min, L.glow.max),
	};
};

/** The Particles page: example.html with the settings filled in (the defaults give example.html itself). */
export const particlesHTML = (settings: ParticlesSettings): string => {
	const s = particlesSettings(settings);
	const rows: string[] = [];
	for (let i = 0; i < s.count; i++) {
		const [top, left, duration, delay, ox, oy, blur, side] =
			i < SEEDS.length ? SEEDS[i] : extra(i);
		const glow = Math.round(blur * s.glow * 100) / 100;
		rows.push(
			`.background span:nth-child(${i + 1}) { color: ${s.colors[i % 3]}; top: ${top}%; left: ${left}%; animation-duration: ${duration}s; animation-delay: ${delay}s; transform-origin: ${ox}vw ${oy}vh; box-shadow: ${side * s.spread}vmin 0 ${glow}vmin currentColor; }`,
		);
	}
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Particles</title>
<style>
  body { margin: 0; overflow: hidden; }
  .background { width: 100vw; height: 100vh; background: ${s.background}; }
  .background span {
    width: ${s.size}vmin; height: ${s.size}vmin; border-radius: ${s.size}vmin;
    backface-visibility: hidden; position: absolute;
    animation-name: move; animation-duration: 6s; animation-timing-function: linear; animation-iteration-count: infinite;
  }
  ${rows.join("\n  ")}
  @keyframes move { 100% { transform: translate3d(0, 0, 1px) rotate(360deg); } }
</style>
</head>
<body>
  <div class="background">${"<span></span>".repeat(s.count)}</div>
</body>
</html>
`;
};
