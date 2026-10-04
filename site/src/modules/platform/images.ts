export const readFileAsDataURL = (file: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") {
				resolve(reader.result);
			} else {
				reject(new Error("The file could not be read."));
			}
		};
		reader.onerror = () =>
			reject(reader.error ?? new Error("The file could not be read."));
		reader.readAsDataURL(file);
	});

export const formatBytes = (bytes: number): string =>
	bytes < 1024
		? `${bytes} bytes`
		: bytes < 1024 * 1024
			? `${Math.round(bytes / 1024)} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Encodes a canvas as WebP where the browser can, else as `fallback`. */
export const canvasToDataURL = (
	canvas: HTMLCanvasElement,
	fallback: "image/png" | "image/jpeg",
	quality: number,
): string => {
	const webp = canvas.toDataURL("image/webp", quality);
	return webp.startsWith("data:image/webp")
		? webp
		: canvas.toDataURL(fallback, quality);
};
