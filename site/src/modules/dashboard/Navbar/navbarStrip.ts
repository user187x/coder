/**
 * The navbar backstrip's background: its own colour (#rrggbb) or, without one, the theme's surface, at the opacity
 * its transparency leaves.
 */
export const navbarStripColor = (
	color: string | null | undefined,
	transparency: number,
): string => {
	const alpha = 1 - transparency / 100;
	const hex = color?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!hex) {
		return `hsl(var(--surface-primary) / ${alpha})`;
	}
	const [r, g, b] = hex.slice(1).map((part) => Number.parseInt(part, 16));
	return `rgb(${r} ${g} ${b} / ${alpha})`;
};

/**
 * The ink that reads on the strip: "light" (white) on a dark colour, "dark" on a light one; null where the strip is
 * the theme's own surface or mostly see-through (the theme's colours read there already).
 */
export const navbarInk = (
	color: string | null | undefined,
	transparency: number,
): "light" | "dark" | null => {
	const hex = color?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!hex || transparency > 50) {
		return null;
	}
	const [r, g, b] = hex
		.slice(1)
		.map((part) => Number.parseInt(part, 16) / 255)
		.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	// Relative luminance (WCAG): white text has the better contrast below about 0.18.
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18 ? "light" : "dark";
};
