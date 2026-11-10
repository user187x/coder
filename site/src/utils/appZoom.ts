/**
 * The app's own scale (index.css's --app-zoom on the root): positions and sizes measured on the screen
 * (getBoundingClientRect, innerHeight) are in screen pixels, and set back as CSS lengths they must be divided by it.
 */
const appZoom = (): number => {
	const zoom = Number.parseFloat(
		getComputedStyle(document.documentElement).zoom,
	);
	return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
};

/** A length measured on the screen, as a CSS length under the app's scale. */
export const toCssPx = (screenPx: number): number => screenPx / appZoom();
