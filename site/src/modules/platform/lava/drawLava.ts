import {
	blobAngle,
	type LavaSettings,
	type LavaVariation,
	lavaHue,
	lavaPalette,
} from "./lava";
import { withLavaSettings } from "./lavaPng";

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
 * backdrop goes behind, unless transparent. A variation
 * makes one copy its own: its speed, the turn and mirroring of its lava, where
 * its colour cycle and each lump start.
 */
export const lavaRenderer = (size: number) => {
	const lamp = newContext(size);
	const blobs = newContext(size);
	const goo = newContext(size);
	// Safari before 18 has no canvas filters: the lumps are drawn without merging.
	const canBlur = typeof goo.filter === "string";

	return (
		target: Ctx,
		settings: LavaSettings,
		seconds: number,
		variation?: LavaVariation,
	) => {
		const s = variation
			? {
					...settings,
					spin: settings.spin / variation.speed,
					blobs: settings.blobs.map((b, i) => ({
						...b,
						phase: b.phase + (variation.phases[i] ?? 0),
					})),
				}
			: settings;
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
			blobs.setTransform(1, 0, 0, 1, c, c);
			if (variation) {
				blobs.rotate((variation.turn * Math.PI) / 180);
				blobs.scale(variation.mirror ? -1 : 1, 1);
			}
			blobs.translate(px - c, py - c);
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

		const hue = lavaHue(
			s,
			seconds + (variation ? variation.cycle * s.spin * 3 : 0),
		);
		if (hue) {
			const all = lamp.getImageData(0, 0, size, size);
			hueRotate(all.data, hue);
			lamp.putImageData(all, 0, 0);
		}

		target.clearRect(0, 0, size, size);
		if (!s.transparent) {
			target.fillStyle = s.backdrop;
			target.fillRect(0, 0, size, size);
		}
		target.drawImage(lamp.canvas, 0, 0);
	};
};

/** What a chooser takes: the picture's size and its limit. */
export type LavaPictureOptions = {
	/** Width and height in pixels, at best. */
	size: number;
	/** The chooser's limit; the picture is made smaller until it fits. */
	maxBytes: number;
};

const toPng = async (ctx: Ctx): Promise<Uint8Array> => {
	const blob = await new Promise<Blob | null>((resolve) =>
		ctx.canvas.toBlob(resolve, "image/png"),
	);
	if (!blob) {
		throw new Error("This browser could not make the picture.");
	}
	return new Uint8Array(await blob.arrayBuffer());
};

/**
 * The lava lamp as a picture: a still PNG of its first moment carrying its
 * settings (lavaPng.ts), from which the dashboard draws every copy live. The
 * still is what shows where it cannot, such as another application.
 */
export const lavaPicture = async (
	s: LavaSettings,
	{ size, maxBytes }: LavaPictureOptions,
): Promise<File> => {
	for (let side = size; side >= 32; side = Math.round(side * 0.8)) {
		const out = newContext(side);
		lavaRenderer(side)(out, s, 0);
		const png = withLavaSettings(await toPng(out), s);
		if (png.length <= maxBytes) {
			return new File([Uint8Array.from(png)], "lava.png", {
				type: "image/png",
			});
		}
	}
	throw new Error("This picture's size limit is too small for the lava lamp.");
};
