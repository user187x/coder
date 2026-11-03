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
 * The width a one-line flex row's items take: their own widths and the gaps
 * between them. Not scrollWidth: items spread out (justify-content) or
 * running into the padding do not make the row overflow, yet no longer fit.
 */
const rowWidth = (el: HTMLElement): number => {
	const items = [...el.children];
	const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
	return (
		items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) +
		gap * Math.max(0, items.length - 1)
	);
};

/**
 * Keeps a flex row on one line by shrinking its text: the largest font size up
 * to `max` px (down to `min`) at which its items fit inside its padding,
 * measured again when the row is resized or its text changes (a figure grows,
 * a change appears). `shown`: the row is rendered (it may appear later).
 */
export const useFitText = (
	ref: React.RefObject<HTMLElement | null>,
	max: number,
	min: number,
	shown: boolean,
): number => {
	const [size, setSize] = useState(max);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el || !shown) {
			return;
		}
		const fit = () => {
			const style = getComputedStyle(el);
			const available =
				el.clientWidth -
				Number.parseFloat(style.paddingLeft) -
				Number.parseFloat(style.paddingRight);
			// Start from the largest size, then shrink: a few passes settle the
			// parts that do not scale (borders, rounding).
			let next = max;
			el.style.fontSize = `${next}px`;
			for (let pass = 0; pass < 4; pass++) {
				const needed = rowWidth(el);
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
		const resized = new ResizeObserver(() => {
			if (el.clientWidth !== width) {
				width = el.clientWidth;
				fit();
			}
		});
		resized.observe(el);
		// New figures, or a change (▲ 2) appearing a render after them.
		const changed = new MutationObserver(fit);
		changed.observe(el, {
			childList: true,
			subtree: true,
			characterData: true,
		});
		return () => {
			resized.disconnect();
			changed.disconnect();
		};
	}, [ref, max, min, shown]);
	return size;
};
