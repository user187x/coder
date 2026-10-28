/**
 * The lava lamp: a glass orb with gooey lava turning in it, its colours slowly
 * cycling (lava.html). Built into the dashboard, so it is always there: drawn
 * live as a background (lavaHTML) and turned into an animated picture for the
 * avatar, logo, icons, sign-in heading and announcement (drawLava.ts). The same
 * settings drive both.
 */

import type { BackgroundFit } from "#/api/platform";

/** One lump of lava, in the orb's own units (the orb is 100 across). */
export type LavaBlob = {
	size: number;
	top: number;
	left: number;
	/** The point it turns about, in percent of its own box (may lie outside it). */
	originX: number;
	originY: number;
	reverse: boolean;
	/** How far into its turn it starts, as a fraction of one turn. */
	phase: number;
};

export type LavaSettings = {
	name: "lava";
	primary: string;
	accent: string;
	/** Seconds per turn of the lava; the colour cycle takes three. */
	spin: number;
	/** The stronger glow and lighter lava of lava.html's dark theme. */
	bright: boolean;
	/** The colours slowly cycle (hue), as in lava.html. */
	cycle: boolean;
	blobs: LavaBlob[];
	/** The orb's width, in percent of the picture (or of the window's shorter side). */
	size: number;
	/** Behind the orb's glass; with transparent, only inside the orb. */
	backdrop: string;
	/** Nothing around the orb: no backdrop there and, in a picture (whose GIF cannot hold a soft glow), no glow. */
	transparent: boolean;
};

/** lava.html's six lumps. */
const REFERENCE_BLOBS: readonly LavaBlob[] = [
	{
		size: 44,
		top: 12,
		left: 28,
		originX: 50,
		originY: 130,
		reverse: true,
		phase: 0,
	},
	{
		size: 40,
		top: 18,
		left: 30,
		originX: 50,
		originY: -30,
		reverse: false,
		phase: 1 / 3,
	},
	{
		size: 30,
		top: 28,
		left: 35,
		originX: -30,
		originY: -10,
		reverse: true,
		phase: 0,
	},
	{
		size: 28,
		top: 30,
		left: 36,
		originX: -30,
		originY: -10,
		reverse: true,
		phase: 1 / 2,
	},
	{
		size: 30,
		top: 28,
		left: 35,
		originX: 130,
		originY: -10,
		reverse: false,
		phase: 0,
	},
	{
		size: 28,
		top: 30,
		left: 36,
		originX: 130,
		originY: -10,
		reverse: false,
		phase: 2 / 3,
	},
];

export const LAVA_LIMITS = {
	spin: { min: 0.2, max: 6, step: 0.1 },
	size: { min: 20, max: 100, step: 1 },
	blobs: { min: 1, max: 16 },
} as const;

/** A picture: the orb fills it, so an avatar's circle shows exactly the orb. */
export const LAVA_PICTURE_DEFAULT: LavaSettings = {
	name: "lava",
	primary: "#ffbf48",
	accent: "#be4a1d",
	spin: 2,
	bright: true,
	cycle: true,
	blobs: [...REFERENCE_BLOBS],
	size: 100,
	// The dark theme's surface (--surface-primary, hsl(240 10% 4%)).
	backdrop: "#09090b",
	transparent: true,
};

/** A background: the orb in the middle of the window, its glow around it. */
export const LAVA_BACKGROUND_DEFAULT: LavaSettings = {
	...LAVA_PICTURE_DEFAULT,
	size: 60,
};

/** A new lump, placed and turning at random (lava.html's "Add Lava"). */
export const randomBlob = (random: () => number = Math.random): LavaBlob => ({
	size: Math.floor(random() * 25) + 20,
	top: Math.floor(random() * 40) + 10,
	left: Math.floor(random() * 40) + 10,
	originX: Math.floor(random() * 260) - 80,
	originY: Math.floor(random() * 260) - 80,
	reverse: random() > 0.5,
	phase: Math.round(random() * 100) / 100,
});

const HEX = /^#[0-9a-f]{6}$/i;
const color = (value: unknown, fallback: string) =>
	typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;
const number = (value: unknown, fallback: number, min: number, max: number) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
const flag = (value: unknown, fallback: boolean) =>
	typeof value === "boolean" ? value : fallback;

const blobOf = (value: unknown): LavaBlob | null => {
	if (!value || typeof value !== "object") {
		return null;
	}
	const v = value as Record<string, unknown>;
	return {
		size: number(v.size, 30, 4, 100),
		top: number(v.top, 30, -50, 150),
		left: number(v.left, 30, -50, 150),
		originX: number(v.originX, 50, -300, 300),
		originY: number(v.originY, 50, -300, 300),
		reverse: flag(v.reverse, false),
		phase: number(v.phase, 0, 0, 1),
	};
};

/** Settings read back from storage: anything missing or out of bounds is the default. */
export const lavaSettings = (
	value: unknown,
	fallback: LavaSettings = LAVA_BACKGROUND_DEFAULT,
): LavaSettings => {
	const v = (value && typeof value === "object" ? value : {}) as Record<
		string,
		unknown
	>;
	const blobs = Array.isArray(v.blobs)
		? v.blobs
				.map(blobOf)
				.filter((b): b is LavaBlob => b !== null)
				.slice(0, LAVA_LIMITS.blobs.max)
		: [];
	return {
		name: "lava",
		primary: color(v.primary, fallback.primary),
		accent: color(v.accent, fallback.accent),
		spin: number(
			v.spin,
			fallback.spin,
			LAVA_LIMITS.spin.min,
			LAVA_LIMITS.spin.max,
		),
		bright: flag(v.bright, fallback.bright),
		cycle: flag(v.cycle, fallback.cycle),
		blobs: blobs.length > 0 ? blobs : [...fallback.blobs],
		size: number(
			v.size,
			fallback.size,
			LAVA_LIMITS.size.min,
			LAVA_LIMITS.size.max,
		),
		backdrop: color(v.backdrop, fallback.backdrop),
		transparent: flag(v.transparent, fallback.transparent),
	};
};

type Rgb = [number, number, number];

export const hexToRgb = (hex: string): Rgb => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16),
];

const rgbToHex = (rgb: Rgb) =>
	`#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** Raises a colour's HSL lightness (lava.html's dark theme: #ffbf48 to #ffcf60, #be4a1d to #d05a2d). */
const lighten = (hex: string, amount: number): string => {
	const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	const h =
		d === 0
			? 0
			: max === r
				? ((g - b) / d + 6) % 6
				: max === g
					? (b - r) / d + 2
					: (r - g) / d + 4;
	const l2 = Math.min(1, l + amount);
	const c = (1 - Math.abs(2 * l2 - 1)) * s;
	const x = c * (1 - Math.abs((h % 2) - 1));
	const m = l2 - c / 2;
	const [r1, g1, b1] =
		h < 1
			? [c, x, 0]
			: h < 2
				? [x, c, 0]
				: h < 3
					? [0, c, x]
					: h < 4
						? [0, x, c]
						: h < 5
							? [x, 0, c]
							: [c, 0, x];
	return rgbToHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
};

/** The colours lava.html derives from its two (its CSS variables), in its light or dark theme. */
export const lavaPalette = (s: LavaSettings) => {
	const rgba = (hex: string, alpha: number) =>
		`rgba(${hexToRgb(hex).join(",")},${alpha})`;
	const strong = s.bright ? 0.8 : 0.5;
	return {
		lava1: s.bright ? lighten(s.primary, 0.05) : s.primary,
		lava2: s.bright ? lighten(s.accent, 0.07) : s.accent,
		border1: s.primary,
		border2: s.accent,
		shadowOuter: rgba(s.primary, strong),
		shadowInner: rgba(s.accent, strong),
		gradientStart: rgba(s.primary, s.bright ? 0.4 : 0.25),
		gradientEnd: rgba(s.accent, s.bright ? 0.6 : 0.5),
		insetTop: rgba(s.primary, strong),
		insetBottom: rgba(s.accent, strong),
	};
};

/** lava.html's colour cycle: [time as a fraction of the cycle, hue rotation in degrees]. */
const COLORIZE: readonly [number, number][] = [
	[0, 0],
	[0.2, -30],
	[0.4, -60],
	[0.6, -90],
	[0.8, -45],
	[1, 0],
];

/** CSS's ease-in-out, cubic-bezier(0.42, 0, 0.58, 1), at x in [0, 1]. */
const easeInOut = (x: number): number => {
	const bezier = (t: number, a: number, b: number) =>
		3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 30; i++) {
		const mid = (lo + hi) / 2;
		if (bezier(mid, 0.42, 0.58) < x) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return bezier((lo + hi) / 2, 0, 1);
};

/** The hue rotation of the colour cycle at a time (seconds), as the CSS animation has it. */
export const lavaHue = (s: LavaSettings, seconds: number): number => {
	if (!s.cycle) {
		return 0;
	}
	const period = s.spin * 3;
	const p = (((seconds % period) + period) % period) / period;
	for (let i = 1; i < COLORIZE.length; i++) {
		const [t1, h1] = COLORIZE[i];
		const [t0, h0] = COLORIZE[i - 1];
		if (p <= t1) {
			return h0 + (h1 - h0) * easeInOut((p - t0) / (t1 - t0));
		}
	}
	return 0;
};

/** A lump's turn (degrees) at a time (seconds), as its CSS animation has it. */
export const blobAngle = (
	s: LavaSettings,
	blob: LavaBlob,
	seconds: number,
): number => {
	const turn = (((seconds / s.spin + blob.phase) % 1) + 1) % 1;
	return (blob.reverse ? -turn : turn) * 360;
};

/** How long the animation takes to come back to where it started. */
export const lavaLoopSeconds = (s: LavaSettings) =>
	s.cycle ? s.spin * 3 : s.spin;

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * lava.html's glow (a box-shadow of the orb, blurred by blur px, its colour at
 * alpha) as radial-gradient stops: the same Gaussian falloff around the orb's
 * edge, out to three standard deviations. A gradient stays smooth however far
 * the orb is scaled up, where a scaled box-shadow shows blocks.
 */
const glow = (hex: string, alpha: number, blur: number) => {
	const sigma = blur / 2;
	const outer = 50 + 3 * sigma;
	const [r, g, b] = hexToRgb(hex);
	// Φ(z), the share of the shadow at distance z standard deviations inside its edge.
	const stops: [number, number][] = [
		[-1, 0.84],
		[0, 0.5],
		[1, 0.16],
		[2, 0.023],
		[3, 0],
	];
	return stops
		.map(
			([z, share]) =>
				`rgba(${r},${g},${b},${round(alpha * share)}) ${round(((50 + z * sigma) / outer) * 100)}%`,
		)
		.join(",");
};

/** A picture background's fit at its own size (Center, Tile): the orb a 256-pixel picture would hold. */
const NATURAL_PX = 256;
/** Tiles at most: each one is a whole lamp, filters and all. */
const MAX_TILES = 48;

/**
 * The lava lamp as an HTML background: lava.html's CSS, the lumps as set, and
 * the orb placed by the background's fit, its size a share of the length that
 * fit goes by: the window's longer side (Fill), its shorter side (Fit inside),
 * its width (Span), each side (Stretch: an oval), or the orb's own size
 * (Center; Tile, repeated across, at most 48 times). Inline styles and script
 * only, as the platform service serves HTML backgrounds.
 */
export const lavaHTML = (
	settings: LavaSettings,
	fit: BackgroundFit = "contain",
): string => {
	const s = lavaSettings(settings);
	const p = lavaPalette(s);
	const strong = s.bright ? 0.8 : 0.5;
	const blobs = s.blobs
		.map(
			(b) =>
				`<div class="blob" style="width:${round(b.size)}px;height:${round(b.size)}px;top:${round(b.top)}px;left:${round(b.left)}px;transform-origin:${round(b.originX)}% ${round(b.originY)}%;animation-direction:${b.reverse ? "reverse" : "normal"};animation-delay:${round(-b.phase * s.spin)}s"></div>`,
		)
		.join("");
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:${s.transparent ? "transparent" : s.backdrop}}
body{display:grid;grid-template-columns:1fr}
.cell{display:flex;align-items:center;justify-content:center;min-width:0;min-height:0}
.lamp{--t:${s.spin}s;position:relative;width:100px;height:100px;flex:none;${s.cycle ? "animation:colorize calc(var(--t)*3) ease-in-out infinite" : ""}}
.glow{position:absolute;border-radius:50%;pointer-events:none}
.g1{inset:-37.5px;background:radial-gradient(closest-side,${glow(s.primary, strong, 25)});-webkit-mask:radial-gradient(circle at 50% 50%,transparent 49px,#000 50px);mask:radial-gradient(circle at 50% 50%,transparent 49px,#000 50px)}
.g2{left:-75px;top:-55px;width:250px;height:250px;background:radial-gradient(closest-side,${glow(s.accent, strong, 50)});-webkit-mask:radial-gradient(circle at 50% 42%,transparent 49px,#000 50px);mask:radial-gradient(circle at 50% 42%,transparent 49px,#000 50px)}
.loader{position:absolute;inset:0;border-radius:50%;overflow:hidden}
.loader::before{content:"";position:absolute;inset:0;border-radius:50%;border-top:1px solid ${p.border1};border-bottom:1px solid ${p.border2};background:linear-gradient(180deg,${p.gradientStart},${p.gradientEnd});box-shadow:inset 0 10px 10px 0 ${p.insetTop},inset 0 -10px 10px 0 ${p.insetBottom}}
.inner{position:absolute;inset:0;border-radius:50%;overflow:hidden;filter:url(#goo)}
.blob{position:absolute;border-radius:42%;background:linear-gradient(180deg,${p.lava1} 30%,${p.lava2} 70%);animation:spin var(--t) linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes colorize{0%{filter:hue-rotate(0deg)}20%{filter:hue-rotate(-30deg)}40%{filter:hue-rotate(-60deg)}60%{filter:hue-rotate(-90deg)}80%{filter:hue-rotate(-45deg)}100%{filter:hue-rotate(0deg)}}
</style></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="goo"><feGaussianBlur in="SourceGraphic" stdDeviation="5"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/></filter></svg>
<template id="lamp"><div class="lamp"><div class="glow g1"></div><div class="glow g2"></div><div class="loader"><div class="inner">${blobs}</div></div></div></template>
<script>(()=>{const F=${JSON.stringify(fit)},S=${s.size / 100},N=${NATURAL_PX},M=${MAX_TILES},B=document.body,T=document.getElementById("lamp");
const lay=()=>{const W=innerWidth,H=innerHeight;for(const c of [...B.querySelectorAll(".cell")])c.remove();
let n=1,x,y;if(F==="tile"){const side=Math.max(N*S,Math.sqrt((W*H)/M));const cols=Math.ceil(W/side),rows=Math.ceil(H/side);n=cols*rows;B.style.gridTemplateColumns="repeat("+cols+",1fr)";B.style.gridAutoRows=H/rows+"px";x=y=Math.min(W/cols,H/rows)*0.9/100}
else{B.style.gridTemplateColumns="1fr";B.style.gridAutoRows="100%";const o=F==="cover"?Math.max(W,H)*S:F==="span"?W*S:F==="center"?N*S:Math.min(W,H)*S;x=F==="stretch"?(W*S)/100:o/100;y=F==="stretch"?(H*S)/100:o/100}
for(let i=0;i<n;i++){const c=document.createElement("div");c.className="cell";const l=T.content.firstElementChild.cloneNode(true);if(x===y)l.style.zoom=String(x);else l.style.transform="scale("+x+","+y+")";c.appendChild(l);B.appendChild(c)}};
addEventListener("resize",lay);lay()})()</script>
</body></html>`;
};
