import { sniffImageType } from "#/utils/normalizeImage";

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * A picture ready to store: an animated GIF as it is (so it keeps moving),
 * anything else scaled to at most 1920 × 1200 and saved as WebP (else JPEG),
 * which keeps photographs small.
 */
export const prepareBackground = async (
	file: File,
): Promise<{ dataURL: string; bytes: number }> => {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const type = sniffImageType(bytes);
	if (!type || type === "image/svg+xml") {
		throw new Error("Choose a PNG, JPEG, WebP, GIF or AVIF image.");
	}
	if (type === "image/gif" && bytes.length <= MAX_BYTES) {
		const dataURL = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(new Error("The file could not be read."));
			reader.readAsDataURL(new Blob([bytes], { type }));
		});
		return { dataURL, bytes: bytes.length };
	}
	const bitmap = await createImageBitmap(new Blob([bytes], { type }));
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
		if (size <= MAX_BYTES) {
			return { dataURL, bytes: size };
		}
	}
	throw new Error("That picture is too large, even made smaller.");
};
