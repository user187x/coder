import { useEffect } from "react";
import { useQuery } from "react-query";
import type { PanelAccent as PanelAccentPreference } from "#/api/platform";
import { panelAccentGlobal, userUIPreferences } from "#/api/queries/platform";
import "./panelAccent.css";

/** The colour a panel accent stands for: the theme's accent (its link colour), or the chosen one. */
export const panelAccentColor = (accent: PanelAccentPreference) =>
	accent.mode === "theme" ? "hsl(var(--content-link))" : accent.color;

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
	return null;
};
