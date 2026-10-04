import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { readFileAsDataURL } from "./images";

/** How an uploaded picture is fitted, so every logo and avatar looks alike. */
type ImageTarget = {
	/** "contain" keeps the whole picture inside the box; "cover" crops a centred square. */
	fit: "contain" | "cover";
	width: number;
	height: number;
	/** Largest file accepted from the user, before resizing. */
	maxInputBytes: number;
	/** Largest file stored after resizing. */
	maxOutputBytes: number;
	/** SVG is kept as it is (it scales by itself); only logos allow it. */
	allowSvg: boolean;
};

const MB = 1024 * 1024;

/** The logo: at most 512 × 256, sharp on high-density screens at the sizes it is shown. */
export const LOGO_TARGET: ImageTarget = {
	fit: "contain",
	width: 512,
	height: 256,
	maxInputBytes: 25 * MB,
	maxOutputBytes: 4 * MB,
	allowSvg: true,
};

/** An avatar: a centred square of at most 256 px. */
export const AVATAR_TARGET: ImageTarget = {
	fit: "cover",
	width: 256,
	height: 256,
	maxInputBytes: 25 * MB,
	maxOutputBytes: 4 * MB,
	allowSvg: false,
};

/** A template or workspace icon: at most 256 × 256, its shape kept. */
export const ICON_TARGET: ImageTarget = {
	fit: "contain",
	width: 256,
	height: 256,
	maxInputBytes: 25 * MB,
	maxOutputBytes: 1 * MB,
	allowSvg: true,
};

/** Animated pictures longer than this keep their first frames only. */
const MAX_FRAMES = 300;
/** Browsers show GIF delays under 20 ms as 100 ms; keep fast animations fast. */
const MIN_FRAME_DELAY_MS = 20;

/** A picture that can't be used; the message says why. */
export class ImageNormalizeError extends Error {}

export type NormalizedImage = {
	dataURL: string;
	type: string;
	bytes: number;
	width: number;
	height: number;
	frames: number;
};

type Rect = { x: number; y: number; width: number; height: number };

/** The part of the source to draw and the size to draw it at; never upscales. */
export const fitImage = (
	width: number,
	height: number,
	target: Pick<ImageTarget, "fit" | "width" | "height">,
): { source: Rect; width: number; height: number } => {
	if (target.fit === "cover") {
		const side = Math.min(width, height);
		const out = Math.max(1, Math.min(side, target.width, target.height));
		return {
			source: {
				x: Math.floor((width - side) / 2),
				y: Math.floor((height - side) / 2),
				width: side,
				height: side,
			},
			width: out,
			height: out,
		};
	}
	const scale = Math.min(1, target.width / width, target.height / height);
	return {
		source: { x: 0, y: 0, width, height },
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
};

/** The image format from the file's first bytes; browsers often leave `File.type` empty or wrong. */
export const sniffImageType = (bytes: Uint8Array): string | null => {
	const ascii = (start: number, end: number) =>
		String.fromCharCode(...bytes.subarray(start, end));
	if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") {
		return "image/png";
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (ascii(0, 4) === "GIF8") {
		return "image/gif";
	}
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
		return "image/webp";
	}
	if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) {
		return "image/avif";
	}
	const head = ascii(0, Math.min(bytes.length, 512)).toLowerCase();
	if (head.includes("<svg") || head.startsWith("<?xml")) {
		return "image/svg+xml";
	}
	return null;
};

/** A frame's delay in milliseconds from its duration in microseconds. */
export const frameDelay = (durationMicroseconds: number | null): number =>
	Math.max(
		MIN_FRAME_DELAY_MS,
		Math.round((durationMicroseconds ?? 100_000) / 1000),
	);

type DecodedFrame = { image: CanvasImageSource; delayMs: number };

const newCanvas = (width: number, height: number) => {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		throw new ImageNormalizeError("This browser cannot draw pictures.");
	}
	context.imageSmoothingQuality = "high";
	return { canvas, context };
};

// Copied into a plain ArrayBuffer: a Blob cannot be built from a shared one.
const blobToDataURL = (bytes: Uint8Array, type: string) =>
	readFileAsDataURL(new Blob([Uint8Array.from(bytes)], { type }));

/**
 * Decodes every frame (up to MAX_FRAMES) with the browser's ImageDecoder,
 * which reads animated GIF, PNG (APNG), WebP and AVIF. null when the browser
 * has no ImageDecoder or cannot read this format.
 */
const decodeFrames = async (
	bytes: Uint8Array<ArrayBuffer>,
	type: string,
): Promise<{
	frames: DecodedFrame[];
	width: number;
	height: number;
	close: () => void;
} | null> => {
	if (
		typeof ImageDecoder === "undefined" ||
		!(await ImageDecoder.isTypeSupported(type))
	) {
		return null;
	}
	const decoder = new ImageDecoder({ data: bytes, type });
	const frames: DecodedFrame[] = [];
	const close = () => {
		for (const frame of frames) {
			if (frame.image instanceof VideoFrame) {
				frame.image.close();
			}
		}
		decoder.close();
	};
	try {
		await decoder.tracks.ready;
		const track = decoder.tracks.selectedTrack;
		const count = track?.animated ? Math.min(track.frameCount, MAX_FRAMES) : 1;
		for (let frameIndex = 0; frameIndex < count; frameIndex++) {
			const { image } = await decoder.decode({ frameIndex });
			frames.push({ image, delayMs: frameDelay(image.duration) });
		}
		const first = frames[0]?.image;
		if (!(first instanceof VideoFrame)) {
			close();
			return null;
		}
		return {
			frames,
			width: first.displayWidth,
			height: first.displayHeight,
			close,
		};
	} catch {
		close();
		return null;
	}
};

/** Every frame drawn at the target size and written as one animated GIF. */
const encodeGif = (
	frames: readonly DecodedFrame[],
	fit: ReturnType<typeof fitImage>,
): Uint8Array => {
	const { context } = newCanvas(fit.width, fit.height);
	const gif = GIFEncoder();
	frames.forEach(({ image, delayMs }, i) => {
		context.clearRect(0, 0, fit.width, fit.height);
		context.drawImage(
			image,
			fit.source.x,
			fit.source.y,
			fit.source.width,
			fit.source.height,
			0,
			0,
			fit.width,
			fit.height,
		);
		const { data } = context.getImageData(0, 0, fit.width, fit.height);
		const palette = quantize(data, 256, {
			format: "rgba4444",
			oneBitAlpha: true,
		});
		const index = applyPalette(data, palette, "rgba4444");
		const transparentIndex = palette.findIndex((color) => color[3] === 0);
		gif.writeFrame(index, fit.width, fit.height, {
			palette,
			delay: delayMs,
			// Each decoded frame is complete, so the previous one is cleared.
			dispose: 2,
			...(i === 0 ? { repeat: 0 } : {}),
			...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
		});
	});
	gif.finish();
	return gif.bytes();
};

const drawStatic = async (
	image: CanvasImageSource,
	fit: ReturnType<typeof fitImage>,
): Promise<Uint8Array> => {
	const { canvas, context } = newCanvas(fit.width, fit.height);
	context.drawImage(
		image,
		fit.source.x,
		fit.source.y,
		fit.source.width,
		fit.source.height,
		0,
		0,
		fit.width,
		fit.height,
	);
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/png"),
	);
	if (!blob) {
		throw new ImageNormalizeError("This browser could not encode the picture.");
	}
	return new Uint8Array(await blob.arrayBuffer());
};

const formatLimit = (bytes: number) => `${Math.round(bytes / MB)} MB`;

/**
 * Turns an uploaded file into the logo or avatar Coder stores: resized to the
 * target (animated pictures keep every frame, re-encoded as an animated GIF;
 * still ones become PNG), so every logo and avatar has the same shape and a
 * small file whatever was uploaded. SVG logos are kept as they are. Where the
 * browser cannot decode frames, an animated file that is already small enough
 * is kept as it is, so it stays animated.
 */
export const normalizeImage = async (
	file: File,
	target: ImageTarget,
): Promise<NormalizedImage> => {
	if (file.size > target.maxInputBytes) {
		throw new ImageNormalizeError(
			`That file is larger than ${formatLimit(target.maxInputBytes)}.`,
		);
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	const type = sniffImageType(bytes);
	if (!type || (type === "image/svg+xml" && !target.allowSvg)) {
		throw new ImageNormalizeError(
			target.allowSvg
				? "Upload a PNG, JPEG, GIF, WebP, AVIF or SVG image."
				: "Upload a PNG, JPEG, GIF, WebP or AVIF image.",
		);
	}
	if (type === "image/svg+xml") {
		if (bytes.length > target.maxOutputBytes) {
			throw new ImageNormalizeError(
				`SVG files are kept as they are, so they must be under ${formatLimit(target.maxOutputBytes)}.`,
			);
		}
		return {
			dataURL: await blobToDataURL(bytes, type),
			type,
			bytes: bytes.length,
			width: 0,
			height: 0,
			frames: 1,
		};
	}

	const decoded = await decodeFrames(bytes, type);
	let output: {
		bytes: Uint8Array;
		type: string;
		width: number;
		height: number;
		frames: number;
	};
	if (decoded) {
		try {
			const fit = fitImage(decoded.width, decoded.height, target);
			output =
				decoded.frames.length > 1
					? {
							bytes: encodeGif(decoded.frames, fit),
							type: "image/gif",
							width: fit.width,
							height: fit.height,
							frames: decoded.frames.length,
						}
					: {
							bytes: await drawStatic(decoded.frames[0].image, fit),
							type: "image/png",
							width: fit.width,
							height: fit.height,
							frames: 1,
						};
		} finally {
			decoded.close();
		}
	} else if (type !== "image/jpeg" && bytes.length <= target.maxOutputBytes) {
		// No frame decoder here: keep a possibly animated picture as it is.
		output = { bytes, type, width: 0, height: 0, frames: 0 };
	} else {
		const bitmap = await createImageBitmap(file).catch(() => {
			throw new ImageNormalizeError("This browser cannot read that picture.");
		});
		try {
			const fit = fitImage(bitmap.width, bitmap.height, target);
			output = {
				bytes: await drawStatic(bitmap, fit),
				type: "image/png",
				width: fit.width,
				height: fit.height,
				frames: 1,
			};
		} finally {
			bitmap.close();
		}
	}

	if (output.bytes.length > target.maxOutputBytes) {
		throw new ImageNormalizeError(
			`Even resized, that picture is ${formatLimit(output.bytes.length)}; the limit is ${formatLimit(target.maxOutputBytes)}. Try a shorter animation.`,
		);
	}
	return {
		dataURL: await blobToDataURL(output.bytes, output.type),
		type: output.type,
		bytes: output.bytes.length,
		width: output.width,
		height: output.height,
		frames: output.frames,
	};
};
