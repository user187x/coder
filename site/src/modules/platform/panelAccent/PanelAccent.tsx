import { useEffect } from "react";
import { useQuery } from "react-query";
import type { PanelAccent as PanelAccentPreference } from "#/api/platform";
import { userUIPreferences } from "#/api/queries/platform";
import "./panelAccent.css";

/** The colour a panel accent stands for: the theme's accent (its link colour), or the user's own. */
const panelAccentColor = (accent: PanelAccentPreference) =>
	accent.mode === "theme" ? "hsl(var(--content-link))" : accent.color;

/**
 * Applies Appearance > Panel accents to the whole dashboard: the document carries the accent, and
 * panelAccent.css tints the Settings menu's and the chat's inner containers with it.
 */
export const PanelAccent: React.FC = () => {
	const preferences = useQuery(userUIPreferences());
	const accent = preferences.data?.panel_accent;
	const color = accent ? panelAccentColor(accent) : null;
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
	return null;
};
