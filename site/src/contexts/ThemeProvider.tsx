import { useEffect } from "react";
import { useQuery } from "react-query";
import { appearanceSettings } from "#/api/queries/users";
import type { UserAppearanceSettings } from "#/api/typesGenerated";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import themes, { baseModeFor, CONCRETE_THEMES, type Theme } from "#/theme";
import { AppearanceProvider } from "#/theme/appearance";
import { ThemeContextProvider } from "#/theme/context";
import { customThemeStyle, parseCustomTheme } from "#/theme/customTheme";
import {
	migrateLegacyPreference,
	resolveActiveThemeName,
} from "#/theme/themeMode";
import { usePreferredColorScheme } from "#/theme/usePreferredColorScheme";

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({
	children,
}) => {
	const { metadata } = useEmbeddedMetadata();
	const appearanceSettingsQuery = useQuery(
		appearanceSettings(metadata.userAppearance),
	);
	const preferredColorScheme = usePreferredColorScheme();

	const settings: Partial<UserAppearanceSettings> =
		appearanceSettingsQuery.data ?? metadata.userAppearance?.value ?? {};
	const state = migrateLegacyPreference(settings);
	const custom =
		settings.theme_mode !== "sync"
			? parseCustomTheme(settings.theme_preference)
			: undefined;
	const concreteName =
		custom?.base ?? resolveActiveThemeName(state, preferredColorScheme);
	const customPreference = custom ? settings.theme_preference : undefined;
	useEffect(() => {
		const palette = parseCustomTheme(customPreference);
		if (!palette || document.documentElement.dataset.embedTheme) return;
		const variables = customThemeStyle(palette);
		const root = document.documentElement;
		for (const [key, value] of Object.entries(variables))
			root.style.setProperty(key, String(value));
		return () => {
			for (const key of Object.keys(variables)) root.style.removeProperty(key);
		};
	}, [customPreference]);

	useEffect(() => {
		const root = document.documentElement;
		// Embedded pages manage theme independently.
		if (root.dataset.embedTheme) {
			return;
		}
		root.classList.add(concreteName);
		root.classList.add(baseModeFor(concreteName));

		return () => {
			if (!root.dataset.embedTheme) {
				root.classList.remove(...CONCRETE_THEMES);
			}
		};
	}, [concreteName]);

	const base = themes[concreteName];
	const theme = custom
		? {
				...base,
				palette: {
					...base.palette,
					primary: { main: custom.accent },
					background: { default: custom.background, paper: custom.surface },
					text: { primary: custom.text },
				},
			}
		: base;

	return <ThemeOverride theme={theme}>{children}</ThemeOverride>;
};

type ThemeOverrideProps = {
	theme: Theme;
	children?: React.ReactNode;
};

export const ThemeOverride: React.FC<ThemeOverrideProps> = ({
	theme,
	children,
}) => {
	return (
		<ThemeContextProvider theme={theme}>
			<AppearanceProvider externalImages={theme.externalImages}>
				{children}
			</AppearanceProvider>
		</ThemeContextProvider>
	);
};
