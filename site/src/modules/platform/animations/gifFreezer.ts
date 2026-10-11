/**
 * Stops animated GIFs: each <img> showing a GIF gets a still copy of its first
 * frame (a PNG data URL); thawing puts the original back. Same-origin (and
 * data:) images only: a cross-origin picture cannot be copied, so it keeps
 * moving. Images whose URL does not say ".gif" (an uploaded logo or avatar)
 * are recognised by their first bytes ("GIF8"), fetched once per URL.
 */
const ORIGINAL = "frozenSrc";
const gifByUrl = new Map<string, Promise<boolean>>();

const sameOrigin = (url: string) => {
	try {
		return new URL(url, window.location.href).origin === window.location.origin;
	} catch {
		return false;
	}
};

const isGif = (url: string): Promise<boolean> => {
	if (url.startsWith("data:")) {
		return Promise.resolve(url.startsWith("data:image/gif"));
	}
	if (!sameOrigin(url)) {
		return Promise.resolve(false);
	}
	let known = gifByUrl.get(url);
	if (!known) {
		known = /\.gif($|[?#])/i.test(new URL(url, window.location.href).pathname)
			? Promise.resolve(true)
			: fetch(url, { credentials: "same-origin" })
					.then(async (response) => {
						if (!response.ok) {
							return false;
						}
						const bytes = new Uint8Array(await response.arrayBuffer(), 0, 4);
						return String.fromCharCode(...bytes) === "GIF8";
					})
					.catch(() => false);
		gifByUrl.set(url, known);
	}
	return known;
};

const firstFrame = async (url: string): Promise<string | undefined> => {
	const image = new Image();
	image.src = url;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext("2d");
	if (!context || !canvas.width || !canvas.height) {
		return undefined;
	}
	context.drawImage(image, 0, 0);
	return canvas.toDataURL("image/png");
};

export const freezeImage = async (img: HTMLImageElement) => {
	const src = img.getAttribute("src");
	if (!src || (img.dataset[ORIGINAL] && src.startsWith("data:image/png"))) {
		return;
	}
	// A new picture since it was frozen.
	delete img.dataset[ORIGINAL];
	if (!(await isGif(src))) {
		return;
	}
	try {
		const still = await firstFrame(src);
		if (still && img.getAttribute("src") === src) {
			img.dataset[ORIGINAL] = src;
			img.setAttribute("src", still);
		}
	} catch {
		// Not decodable here: it keeps moving.
	}
};

export const freezeAll = (root: ParentNode) => {
	for (const img of root.querySelectorAll("img")) {
		void freezeImage(img);
	}
};

export const thawAll = () => {
	for (const img of document.querySelectorAll<HTMLImageElement>(
		"img[data-frozen-src]",
	)) {
		const original = img.dataset[ORIGINAL];
		delete img.dataset[ORIGINAL];
		if (original) {
			img.setAttribute("src", original);
		}
	}
};
