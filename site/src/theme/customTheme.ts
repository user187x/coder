import { type ConcreteThemeName, isConcreteThemeName } from "#/theme";

export type CustomTheme = {
	base: ConcreteThemeName;
	background: string;
	surface: string;
	text: string;
	accent: string;
	border: string;
};

const PREFIX = "custom-v1:";
const HEX = /^#[0-9a-f]{6}$/i;

/** Custom palettes use the existing per-user appearance preference and retain a concrete fallback. */
export const parseCustomTheme = (preference = ""): CustomTheme | undefined => {
	if (!preference.startsWith(PREFIX)) return;
	const [base, background, surface, text, accent, border] = preference
		.slice(PREFIX.length)
		.split(":");
	if (
		!isConcreteThemeName(base) ||
		![background, surface, text, accent, border].every(
			(value) => typeof value === "string" && HEX.test(value),
		)
	)
		return;
	return { base, background, surface, text, accent, border };
};
export const encodeCustomTheme = (theme: CustomTheme) =>
	PREFIX +
	[
		theme.base,
		theme.background,
		theme.surface,
		theme.text,
		theme.accent,
		theme.border,
	].join(":");

const hsl = (hex: string) => {
	const [r, g, b] = [1, 3, 5].map(
		(offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
	);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	const light = (max + min) / 2;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
	const hue =
		delta === 0
			? 0
			: max === r
				? ((g - b) / delta + 6) % 6
				: max === g
					? (b - r) / delta + 2
					: (r - g) / delta + 4;
	return `${hue * 60} ${saturation * 100}% ${light * 100}%`;
};
type ThemeStyle = React.CSSProperties & { [key: `--${string}`]: string };
export const customThemeStyle = (theme: CustomTheme): ThemeStyle => ({
	"--surface-primary": hsl(theme.background),
	"--surface-secondary": hsl(theme.surface),
	"--surface-tertiary": hsl(theme.surface),
	"--content-primary": hsl(theme.text),
	"--content-secondary": hsl(theme.text),
	"--content-link": hsl(theme.accent),
	"--border-default": hsl(theme.border),
	"--border-secondary": hsl(theme.border),
	"--surface-invert-primary": hsl(theme.text),
	"--content-invert": hsl(theme.background),
});
