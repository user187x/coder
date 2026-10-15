import { useLayoutEffect, useState } from "react";

/**
 * The font size (px) at which content `needed` px wide at `current` px fits in
 * `available` px: `max` when it fits there, else smaller in proportion (the
 * content's gaps are in em, so it all scales), in quarter pixels, never below
 * `min`.
 */
export const fitFontSize = (
	current: number,
	needed: number,
	available: number,
	max: number,
	min: number,
): number => {
	if (needed <= 0 || available <= 0) {
		return max;
	}
	const size = Math.floor(((current * available) / needed) * 4) / 4;
	return Math.max(min, Math.min(max, size));
};

/**
 * Keeps an element's content on one line by shrinking its text: the largest
 * font size up to `max` px (down to `min`) at which it fits, measured again
 * when the element is resized or `content` changes.
 */
export const useFitText = (
	ref: React.RefObject<HTMLElement | null>,
	max: number,
	min: number,
	content: unknown,
): number => {
	const [size, setSize] = useState(max);
	// `content` is a dependency only to measure again: it changes the width the line needs.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const fit = () => {
			const style = getComputedStyle(el);
			const padding =
				Number.parseFloat(style.paddingLeft) +
				Number.parseFloat(style.paddingRight);
			// Start from the largest size, then shrink: a few passes settle the
			// parts that do not scale (borders, rounding).
			let next = max;
			el.style.fontSize = `${next}px`;
			for (let pass = 0; pass < 4; pass++) {
				const available = el.clientWidth - padding;
				const needed = el.scrollWidth - padding;
				if (needed <= available + 0.5) {
					break;
				}
				const smaller = fitFontSize(next, needed, available, max, min);
				next = smaller < next ? smaller : Math.max(min, next - 0.25);
				el.style.fontSize = `${next}px`;
				if (next === min) {
					break;
				}
			}
			setSize(next);
		};
		fit();
		// Only a new width: the font size itself changes the height.
		let width = el.clientWidth;
		const observer = new ResizeObserver(() => {
			if (el.clientWidth !== width) {
				width = el.clientWidth;
				fit();
			}
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref, max, min, content]);
	return size;
};
