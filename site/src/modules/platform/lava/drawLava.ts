import { applyPalette, GIFEncoder, quantize } from "gifenc";
import {
	blobAngle,
	type LavaSettings,
	lavaHue,
	lavaLoopSeconds,
	lavaPalette,
} from "./lava";

type Ctx = CanvasRenderingContext2D;

/** Shapes drawn this far off the canvas cast only their shadow onto it (a canvas has no box-shadow). */
const FAR = 10_000;

const newContext = (size: number): Ctx => {
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		throw new Error("This browser cannot draw pictures.");
	}
	return ctx;
};

/** CSS's hue-rotate() (Filter Effects), applied to RGBA pixels in place. */
const hueRotate = (data: Uint8ClampedArray, degrees: number) => {
	const a = Math.cos((degrees * Math.PI) / 180);
	const b = Math.sin((degrees * Math.PI) / 180);
	const m = [
		0.213 + 0.787 * a - 0.213 * b,
		0.715 - 0.715 * a - 0.715 * b,
		0.072 - 0.072 * a + 0.928 * b,
		0.213 - 0.213 * a + 0.143 * b,
		0.715 + 0.285 * a + 0.14 * b,
		0.072 - 0.072 * a - 0.283 * b,
		0.213 - 0.213 * a - 0.787 * b,
		0.715 - 0.715 * a + 0.715 * b,
		0.072 + 0.928 * a + 0.072 * b,
	];
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] === 0) {
			continue;
		}
		const r = data[i];
		const g = data[i + 1];
		const bl = data[i + 2];
		data[i] = m[0] * r + m[1] * g + m[2] * bl;
		data[i + 1] = m[3] * r + m[4] * g + m[5] * bl;
		data[i + 2] = m[6] * r + m[7] * g + m[8] * bl;
	}
};

/**
 * Draws the lava lamp into square canvases of one size, as lava.html's CSS
 * draws it: the glow outside the orb (box-shadow), the glass (gradient, inset
 * shadows, top and bottom border), the lumps merged by the goo filter (blur,
 * then alpha × 22 − 9), and the colour cycle (hue-rotate) over all of it. The
 * backdrop goes behind; with transparent, only inside the orb.
 */
export const lavaRenderer = (size: number) => {
	const lamp = newContext(size);
	const blobs = newContext(size);
	const goo = newContext(size);
	// Safari before 18 has no canvas filters: the lumps are drawn without merging.
	const canBlur = typeof goo.filter === "string";

	return (target: Ctx, s: LavaSettings, seconds: number) => {
		const p = lavaPalette(s);
		const u = (size * s.size) / 10_000;
		const c = size / 2;
		const r = 50 * u;
		const circle = (ctx: Ctx, cx = c, cy = c) => {
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
		};

		lamp.setTransform(1, 0, 0, 1, 0, 0);
		lamp.clearRect(0, 0, size, size);
		if (!s.transparent) {
			for (const [color, blur, dy] of [
				[p.shadowOuter, 25, 0],
				[p.shadowInner, 50, 20],
			] as const) {
				lamp.save();
				lamp.shadowColor = color;
				lamp.shadowBlur = blur * u;
				lamp.shadowOffsetX = FAR;
				lamp.shadowOffsetY = dy * u;
				lamp.fillStyle = "#000";
				circle(lamp, c - FAR);
				lamp.fill();
				lamp.restore();
			}
			// A box-shadow is not drawn under its box.
			lamp.save();
			lamp.globalCompositeOperation = "destination-out";
			circle(lamp);
			lamp.fill();
			lamp.restore();
		}

		lamp.save();
		circle(lamp);
		lamp.clip();
		const glass = lamp.createLinearGradient(0, c - r, 0, c + r);
		glass.addColorStop(0, p.gradientStart);
		glass.addColorStop(1, p.gradientEnd);
		lamp.fillStyle = glass;
		lamp.fillRect(c - r, c - r, 2 * r, 2 * r);
		for (const [color, dy] of [
			[p.insetTop, 10],
			[p.insetBottom, -10],
		] as const) {
			lamp.save();
			lamp.shadowColor = color;
			lamp.shadowBlur = 10 * u;
			lamp.shadowOffsetX = FAR;
			lamp.fillStyle = "#000";
			lamp.beginPath();
			lamp.rect(c - FAR - 4 * r, c - 4 * r, 8 * r, 8 * r);
			lamp.arc(c - FAR, c + dy * u, r, 0, Math.PI * 2);
			lamp.fill("evenodd");
			lamp.restore();
		}
		lamp.lineWidth = u;
		for (const [color, from] of [
			[p.border1, 1.25],
			[p.border2, 0.25],
		] as const) {
			lamp.strokeStyle = color;
			lamp.beginPath();
			lamp.arc(c, c, r - u / 2, from * Math.PI, (from + 0.5) * Math.PI);
			lamp.stroke();
		}
		lamp.restore();

		blobs.setTransform(1, 0, 0, 1, 0, 0);
		blobs.clearRect(0, 0, size, size);
		for (const b of s.blobs) {
			const x = c - r + b.left * u;
			const y = c - r + b.top * u;
			const w = b.size * u;
			const px = x + (w * b.originX) / 100;
			const py = y + (w * b.originY) / 100;
			blobs.setTransform(1, 0, 0, 1, px, py);
			blobs.rotate((blobAngle(s, b, seconds) * Math.PI) / 180);
			blobs.translate(-px, -py);
			const lava = blobs.createLinearGradient(0, y, 0, y + w);
			lava.addColorStop(0.3, p.lava1);
			lava.addColorStop(0.7, p.lava2);
			blobs.fillStyle = lava;
			blobs.beginPath();
			blobs.roundRect(x, y, w, w, 0.42 * w);
			blobs.fill();
		}
		blobs.setTransform(1, 0, 0, 1, 0, 0);
		blobs.globalCompositeOperation = "destination-in";
		circle(blobs);
		blobs.fill();
		blobs.globalCompositeOperation = "source-over";

		goo.clearRect(0, 0, size, size);
		if (canBlur) {
			goo.filter = `blur(${5 * u}px)`;
		}
		goo.drawImage(blobs.canvas, 0, 0);
		goo.filter = "none";
		const merged = goo.getImageData(0, 0, size, size);
		for (let i = 3; i < merged.data.length; i += 4) {
			merged.data[i] = 22 * merged.data[i] - 9 * 255;
		}
		goo.putImageData(merged, 0, 0);
		goo.globalCompositeOperation = "destination-in";
		circle(goo);
		goo.fill();
		goo.globalCompositeOperation = "source-over";
		lamp.drawImage(goo.canvas, 0, 0);

		const hue = lavaHue(s, seconds);
		if (hue) {
			const all = lamp.getImageData(0, 0, size, size);
			hueRotate(all.data, hue);
			lamp.putImageData(all, 0, 0);
		}

		target.clearRect(0, 0, size, size);
		target.fillStyle = s.backdrop;
		if (s.transparent) {
			circle(target);
			target.fill();
		} else {
			target.fillRect(0, 0, size, size);
		}
		target.drawImage(lamp.canvas, 0, 0);
	};
};

type Quality = { fps: number; colors: number };

/**
 * Smoothness and colours, best first. Frame rates are ones whose frame times
 * GIF stores exactly (hundredths of a second).
 */
const QUALITIES: readonly Quality[] = [
	{ fps: 20, colors: 256 },
	{ fps: 12.5, colors: 128 },
	{ fps: 10, colors: 64 },
	{ fps: 6.25, colors: 32 },
];

/** Measured: the lava lamp's GIF grows with its side to the power 1.26 and with its frame rate; fewer colours shrink it so. */
const COLOR_COST: Record<number, number> = {
	256: 1,
	128: 0.84,
	64: 0.7,
	32: 0.58,
};
const SIDE_POWER = 1.26;
const cost = (side: number, q: Quality) =>
	side ** SIDE_POWER * q.fps * COLOR_COST[q.colors];

/** A quality keeps at least this share of the asked size before a choppier one is tried. */
const KEEP_SIZE = 0.85;
/** Smaller than this, a picture is no longer worth making. */
const MIN_SIDE = 32;
/** The small first try that measures how large these settings make a GIF. */
const PROBE_SIDE = 64;

/** One loop as an animated GIF; nearly transparent pixels become its one transparent colour. */
const encodeGif = async (
	s: LavaSettings,
	size: number,
	{ fps, colors }: Quality,
): Promise<Uint8Array> => {
	const loop = lavaLoopSeconds(s);
	const frames = Math.max(1, Math.round(loop * fps));
	const out = newContext(size);
	const draw = lavaRenderer(size);
	const gif = GIFEncoder();
	for (let i = 0; i < frames; i++) {
		draw(out, s, (i * loop) / frames);
		const { data } = out.getImageData(0, 0, size, size);
		// Colours from RGB at 5-6-5 bits (smoother gradients than RGBA at 4 bits), the last one transparent.
		const palette = quantize(data, colors - 1, { format: "rgb565" });
		const index = applyPalette(data, palette, "rgb565");
		const transparentIndex = palette.length;
		let transparent = false;
		for (let px = 0; px < index.length; px++) {
			if (data[px * 4 + 3] < 128) {
				index[px] = transparentIndex;
				transparent = true;
			}
		}
		gif.writeFrame(index, size, size, {
			palette: transparent ? [...palette, [0, 0, 0]] : palette,
			delay: 1000 / fps,
			dispose: 2,
			...(i === 0 ? { repeat: 0 } : {}),
			...(transparent ? { transparent: true, transparentIndex } : {}),
		});
		if (i % 4 === 3) {
			// Let the page breathe: a loop takes a moment.
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}
	gif.finish();
	return gif.bytes();
};

/** What a chooser takes: the picture's best size and its limit. */
export type LavaPictureOptions = {
	/** Width and height in pixels, at best. */
	size: number;
	/** The chooser's limit; the picture is made smaller or choppier until it fits. */
	maxBytes: number;
};

/**
 * The lava lamp as an animated GIF of one whole loop, as large and smooth as
 * the chooser's limit allows, whatever the settings: a small first try
 * measures how large they make a GIF, which sets the size and smoothness to
 * make it at; a try that still comes out too large measures again and is
 * made smaller, until it fits.
 */
export const lavaPicture = async (
	s: LavaSettings,
	{ size, maxBytes }: LavaPictureOptions,
): Promise<File> => {
	const target = maxBytes * 0.92;
	const probe = await encodeGif(s, PROBE_SIDE, QUALITIES[0]);
	// Bytes per unit of cost, from the latest try.
	let rate = probe.length / cost(PROBE_SIDE, QUALITIES[0]);
	const largest = (q: Quality) =>
		Math.min(
			size,
			Math.floor(
				(target / (rate * q.fps * COLOR_COST[q.colors])) ** (1 / SIDE_POWER),
			),
		);
	for (let attempt = 0; attempt < 6; attempt++) {
		const quality =
			QUALITIES.find((q) => largest(q) >= size * KEEP_SIZE) ??
			QUALITIES[QUALITIES.length - 1];
		const side = largest(quality);
		if (side < MIN_SIDE) {
			break;
		}
		const bytes = await encodeGif(s, side, quality);
		if (bytes.length <= maxBytes) {
			return new File([Uint8Array.from(bytes)], "lava.gif", {
				type: "image/gif",
			});
		}
		rate = bytes.length / cost(side, quality);
	}
	throw new Error(
		"This picture's size limit is too small for the lava lamp. Turn off the colour cycle or use fewer lumps.",
	);
};
