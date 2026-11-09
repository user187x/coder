import { useEffect } from "react";
import { useQuery } from "react-query";
import type { PanelAccent as PanelAccentPreference } from "#/api/platform";
import { panelAccentGlobal, userUIPreferences } from "#/api/queries/platform";
import "./panelAccent.css";

/** The colour a panel accent stands for: the theme's accent (its link colour), or the chosen one. */
export const panelAccentColor = (accent: PanelAccentPreference) =>
	accent.mode === "theme" ? "hsl(var(--content-link))" : accent.color;

/**
 * A panel text colour as the theme's text tokens (an "H S% L%" triplet each): the colour itself for primary text, and
 * for secondary text the same hue a third of the way to mid-grey, so it stays a step quieter.
 */
export const panelTextTokens = (hex: string) => {
	const [r, g, b] = [1, 3, 5].map(
		(i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255,
	);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	const h =
		d === 0
			? 0
			: max === r
				? 60 * (((g - b) / d) % 6)
				: max === g
					? 60 * ((b - r) / d + 2)
					: 60 * ((r - g) / d + 4);
	const hsl = (lightness: number) =>
		`${Math.round((h + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(lightness * 100)}%`;
	return { primary: hsl(l), secondary: hsl(l + (0.5 - l) / 3) };
};

/** The panels' size, as a browser zoom would make it: 80% to 150%. */
export const PANEL_SCALE = { min: 80, max: 150, step: 5, default: 100 };

/**
 * Applies Appearance > Panel accents to the whole dashboard: the document carries the accent (an admin's Global one
 * over the user's own) and the panels' size, and panelAccent.css tints the Settings menu's and the chat's inner
 * containers with it and zooms those panels.
 */
export const PanelAccent: React.FC = () => {
	const preferences = useQuery(userUIPreferences());
	const global = useQuery(panelAccentGlobal());
	const accent = global.data?.global ?? preferences.data?.panel_accent;
	const color = accent ? panelAccentColor(accent) : null;
	const scale = preferences.data?.panel_scale ?? PANEL_SCALE.default;
	const text = preferences.data?.panel_text_color ?? null;
	useEffect(() => {
		const root = document.documentElement;
		if (!color) return;
		root.dataset.panelAccent = "";
		root.style.setProperty("--panel-accent", color);
		return () => {
			delete root.dataset.panelAccent;
			root.style.removeProperty("--panel-accent");
		};
	}, [color]);
	useEffect(() => {
		const root = document.documentElement;
		if (scale === PANEL_SCALE.default) return;
		root.style.setProperty("--panel-zoom", String(scale / 100));
		return () => {
			root.style.removeProperty("--panel-zoom");
		};
	}, [scale]);
	useEffect(() => {
		const root = document.documentElement;
		if (!text) return;
		const tokens = panelTextTokens(text);
		root.dataset.panelText = "";
		root.style.setProperty("--panel-text-primary", tokens.primary);
		root.style.setProperty("--panel-text-secondary", tokens.secondary);
		return () => {
			delete root.dataset.panelText;
			root.style.removeProperty("--panel-text-primary");
			root.style.removeProperty("--panel-text-secondary");
		};
	}, [text]);
	return null;
};
