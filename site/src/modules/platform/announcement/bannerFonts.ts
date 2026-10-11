import type { BannerFont } from "#/api/platform";

/**
 * The announcement's fonts: the dashboard's bundled fonts and generic stacks
 * that always resolve to something installed - nothing is fetched (the
 * network may be air-gapped). The banner service accepts the same keys.
 */
export const BANNER_FONT_OPTIONS: Record<
	BannerFont,
	{ label: string; stack: string | undefined }
> = {
	default: { label: "Dashboard (Geist)", stack: undefined },
	sans: {
		label: "System sans-serif",
		stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	},
	serif: {
		label: "Serif",
		stack: "Georgia, 'Times New Roman', 'Liberation Serif', serif",
	},
	condensed: {
		label: "Condensed (crawl)",
		stack:
			"'Franklin Gothic Medium', 'Arial Narrow', 'Liberation Sans Narrow', 'Roboto Condensed', sans-serif",
	},
	"geist-mono": {
		label: "Geist Mono",
		stack: "'Geist Mono Variable', monospace",
	},
	"ibm-plex-mono": {
		label: "IBM Plex Mono",
		stack: "'IBM Plex Mono', monospace",
	},
	"jetbrains-mono": {
		label: "JetBrains Mono",
		stack: "'JetBrains Mono', monospace",
	},
	"fira-code": { label: "Fira Code", stack: "'Fira Code', monospace" },
	"source-code-pro": {
		label: "Source Code Pro",
		stack: "'Source Code Pro', monospace",
	},
};

export const bannerFontStack = (font: BannerFont | undefined) =>
	BANNER_FONT_OPTIONS[font ?? "default"]?.stack;
