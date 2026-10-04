const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

const encode = (canvas: HTMLCanvasElement): string => {
	for (let scale = 1; scale > 0.2; scale *= 0.75) {
		let source = canvas;
		if (scale < 1) {
			source = document.createElement("canvas");
			source.width = Math.round(canvas.width * scale);
			source.height = Math.round(canvas.height * scale);
			source
				.getContext("2d")
				?.drawImage(canvas, 0, 0, source.width, source.height);
		}
		let url = source.toDataURL("image/webp", 0.9);
		if (!url.startsWith("data:image/webp")) {
			url = source.toDataURL("image/jpeg", 0.88);
		}
		if ((url.length - url.indexOf(",") - 1) * 0.75 <= MAX_SCREENSHOT_BYTES) {
			return url;
		}
	}
	throw new Error("the page is too large to send as a screenshot");
};

/**
 * What the user sees, minus `exclude` (the chat itself): drawn from the page
 * (html2canvas), so the browser asks nothing. WebP, else JPEG, made smaller
 * until it fits the service's 4 MB. Content html2canvas cannot draw (a WebGL
 * canvas, for example) comes out blank.
 */
export const takeScreenshot = async (exclude: Element | null) => {
	const { default: html2canvas } = await import("html2canvas");
	const canvas = await html2canvas(document.documentElement, {
		x: window.scrollX,
		y: window.scrollY,
		width: window.innerWidth,
		height: window.innerHeight,
		windowWidth: window.innerWidth,
		windowHeight: window.innerHeight,
		scale: Math.min(window.devicePixelRatio || 1, 1.5),
		useCORS: true,
		logging: false,
		backgroundColor: getComputedStyle(document.body).backgroundColor || null,
		ignoreElements: (node) => Boolean(exclude?.contains(node)),
	});
	return {
		dataURL: encode(canvas),
		page: location.pathname + location.search,
	};
};
