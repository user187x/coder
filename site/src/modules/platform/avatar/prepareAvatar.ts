import { canvasToDataURL, readFileAsDataURL } from "../images";

const SIZE = 256;
const MAX_AVATAR_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_GIF_BYTES = 2 * 1024 * 1024;

/** A picture the avatar can't be made from; the message says why. */
export class AvatarImageError extends Error {}

const decode = async (src: string): Promise<HTMLImageElement> => {
	const image = new Image();
	image.decoding = "async";
	image.src = src;
	await image.decode();
	return image;
};

/**
 * An animated GIF is kept as it is (so it stays animated) once the browser
 * proves it can show it. Any other picture is cropped to its centre square
 * and scaled to 256 px, so every format the browser can show works and the
 * stored file stays small.
 */
export const prepareAvatar = async (file: File): Promise<string> => {
	if (file.size > MAX_AVATAR_INPUT_BYTES) {
		throw new AvatarImageError("That file is larger than 25 MB.");
	}
	if (file.type === "image/gif") {
		if (file.size > MAX_GIF_BYTES) {
			throw new AvatarImageError(
				"GIFs are kept as they are, so they must be under 2 MB.",
			);
		}
		const dataURL = await readFileAsDataURL(file);
		await decode(dataURL);
		return dataURL;
	}

	const objectURL = URL.createObjectURL(file);
	try {
		const image = await decode(objectURL);
		const width = image.naturalWidth || SIZE;
		const height = image.naturalHeight || SIZE;
		const side = Math.min(width, height);
		const canvas = document.createElement("canvas");
		canvas.width = SIZE;
		canvas.height = SIZE;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new AvatarImageError("This browser cannot draw pictures.");
		}
		context.imageSmoothingQuality = "high";
		context.drawImage(
			image,
			(width - side) / 2,
			(height - side) / 2,
			side,
			side,
			0,
			0,
			SIZE,
			SIZE,
		);
		return canvasToDataURL(canvas, "image/png", 0.9);
	} finally {
		URL.revokeObjectURL(objectURL);
	}
};
