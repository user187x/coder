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
