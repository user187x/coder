import type { TerminalFontName } from "#/api/typesGenerated";

const MONOSPACE_DEFAULT_FONT = "Geist Mono Variable";
const TERMINAL_SYMBOL_FONT = "'Coder Terminal Symbols'";
export const MONOSPACE_FONT_FAMILY =
	"'Geist Mono Variable', 'IBM Plex Mono', 'Lucida Console', 'Lucida Sans Typewriter', 'Liberation Mono', 'Monaco', 'Courier New', Courier, monospace";

const withTerminalSymbolFallback = (fontFamily: string) =>
	fontFamily.replace(", monospace", `, ${TERMINAL_SYMBOL_FONT}, monospace`);

export const terminalFonts: Record<TerminalFontName, string> = {
	"fira-code": withTerminalSymbolFallback(
		MONOSPACE_FONT_FAMILY.replace(MONOSPACE_DEFAULT_FONT, "Fira Code"),
	),
	"jetbrains-mono": withTerminalSymbolFallback(
		MONOSPACE_FONT_FAMILY.replace(MONOSPACE_DEFAULT_FONT, "JetBrains Mono"),
	),
	"jetbrains-mono-nerd": withTerminalSymbolFallback(
		MONOSPACE_FONT_FAMILY.replace(
			MONOSPACE_DEFAULT_FONT,
			"JetBrainsMono Nerd Font', 'JetBrains Mono",
		),
	),
	"source-code-pro": withTerminalSymbolFallback(
		MONOSPACE_FONT_FAMILY.replace(MONOSPACE_DEFAULT_FONT, "Source Code Pro"),
	),
	"ibm-plex-mono": withTerminalSymbolFallback(
		MONOSPACE_FONT_FAMILY.replace(MONOSPACE_DEFAULT_FONT, "IBM Plex Mono"),
	),
	"geist-mono": withTerminalSymbolFallback(MONOSPACE_FONT_FAMILY),

	"": withTerminalSymbolFallback(
		MONOSPACE_FONT_FAMILY.replace(
			MONOSPACE_DEFAULT_FONT,
			"JetBrainsMono Nerd Font', 'JetBrains Mono",
		),
	),
};
export const terminalFontLabels: Record<TerminalFontName, string> = {
	"geist-mono": "Geist Mono",
	"fira-code": "Fira Code",
	"jetbrains-mono": "JetBrains Mono",
	"jetbrains-mono-nerd": "JetBrains Mono Nerd Font",
	"source-code-pro": "Source Code Pro",
	"ibm-plex-mono": "IBM Plex Mono",
	"": "", // needed for enum completeness, otherwise fails the build
};
// The JetBrains Mono Nerd Font bundled with the dashboard (fonts/jetbrains-mono-nerd.css),
// which also ships in the workspace image as the desktop's font.
export const DEFAULT_TERMINAL_FONT = "jetbrains-mono-nerd";

export const navHeight = 62;
export const containerWidth = 1380;
export const containerWidthMedium = 1080;
export const sidePadding = 24;
