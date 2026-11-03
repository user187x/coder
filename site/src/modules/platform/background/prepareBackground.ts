import { readFileAsDataURL } from "#/utils/images";
import { sniffImageType } from "#/utils/normalizeImage";

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;
const MAX_STILL_BYTES = 4 * 1024 * 1024;

/**
 * A picture ready to store: an animated GIF as it is (so it keeps moving),
 * anything else scaled to at most 1920 × 1200 and saved as WebP (else JPEG),
 * which keeps photographs small.
 */
export const prepareBackground = async (
	file: File,
	maxBytes: number,
): Promise<{ dataURL: string; bytes: number }> => {
	const header = new Uint8Array(await file.slice(0, 512).arrayBuffer());
	const type = sniffImageType(header);
	if (!type || type === "image/svg+xml") {
		throw new Error("Choose a PNG, JPEG, WebP, GIF or AVIF image.");
	}
	if (type === "image/gif") {
		if (file.size > maxBytes) {
			throw new Error(
				`GIF backgrounds must be ${maxBytes / (1024 * 1024)} MiB or smaller.`,
			);
		}
		// Preserve the original frames, delays and loop count even if the file has no MIME type.
		const dataURL = await readFileAsDataURL(file.slice(0, file.size, type));
		return { dataURL, bytes: file.size };
	}
	const bitmap = await createImageBitmap(file.slice(0, file.size, type));
	const scale = Math.min(
		1,
		MAX_WIDTH / bitmap.width,
		MAX_HEIGHT / bitmap.height,
	);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	for (const quality of [0.85, 0.7, 0.55]) {
		let dataURL = canvas.toDataURL("image/webp", quality);
		if (!dataURL.startsWith("data:image/webp")) {
			dataURL = canvas.toDataURL("image/jpeg", quality);
		}
		const size = Math.round((dataURL.length - dataURL.indexOf(",") - 1) * 0.75);
		if (size <= Math.min(maxBytes, MAX_STILL_BYTES)) {
			return { dataURL, bytes: size };
		}
	}
	throw new Error("That picture is too large, even made smaller.");
};
