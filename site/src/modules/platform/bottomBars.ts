/** The bars along the window's bottom: the classification bar, the deployment's bar and any other bar glued there. */
export const BOTTOM_BARS =
	"#coder-classification-bottom, div.sticky.bottom-0, div.fixed.bottom-0";

/**
 * How much of the window's bottom the bars take (px), measured, not assumed (they come and go with settings, pages
 * and permissions): each bar stacked on the window's edge, or on a bar already counted. Bars inside `within`'s
 * own element (the chat dock's) are left out.
 */
export const bottomBarsHeight = (within?: Element | null): number => {
	const height = window.innerHeight;
	const bars = [...document.querySelectorAll(BOTTOM_BARS)]
		.filter((bar) => !within?.contains(bar))
		.map((bar) => bar.getBoundingClientRect())
		.filter(
			(r) =>
				r.width > 0 && r.height > 0 && r.top < height && r.height < height / 3,
		)
		.sort((a, b) => b.bottom - a.bottom);
	let occupied = 0;
	for (const r of bars) {
		// Stacked on the window's edge, or on a bar already counted.
		if (height - r.bottom <= occupied + 2) {
			occupied = Math.max(occupied, height - r.top);
		}
	}
	return Math.round(occupied);
};
