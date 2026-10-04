import { cn } from "cn";
import { MoonIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	appearanceSettings,
	updateAppearanceSettings,
} from "#/api/queries/users";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { baseModeFor } from "#/theme";
import { DEFAULT_TERMINAL_FONT } from "#/theme/constants";
import {
	migrateLegacyPreference,
	resolveActiveThemeName,
} from "#/theme/themeMode";
import { usePreferredColorScheme } from "#/theme/usePreferredColorScheme";

/**
 * The user menu's "Dark Mode" switch. It flips the user's own appearance
 * setting between the dark and light default themes (single-theme mode),
 * keeping their terminal font and the themes picked for "Sync with system".
 * Choosing it keeps the menu open.
 */
export const ThemeToggleItem: React.FC = () => {
	const queryClient = useQueryClient();
	const { metadata } = useEmbeddedMetadata();
	const appearanceQuery = useQuery(appearanceSettings(metadata.userAppearance));
	const updateAppearance = useMutation(updateAppearanceSettings(queryClient));
	const osColorScheme = usePreferredColorScheme();

	const settings =
		appearanceQuery.data ?? metadata.userAppearance?.value ?? undefined;
	const activeTheme = resolveActiveThemeName(
		migrateLegacyPreference(settings ?? {}),
		osColorScheme,
	);
	const isDark = baseModeFor(activeTheme) === "dark";

	return (
		<DropdownMenuItem
			role="menuitemcheckbox"
			aria-checked={isDark}
			disabled={updateAppearance.isPending}
			onSelect={(event) => {
				event.preventDefault();
				updateAppearance.mutate({
					theme_preference: isDark ? "light" : "dark",
					theme_mode: "single",
					theme_light: settings?.theme_light || "light",
					theme_dark: settings?.theme_dark || "dark",
					terminal_font: settings?.terminal_font || DEFAULT_TERMINAL_FONT,
				});
			}}
		>
			<MoonIcon />
			<span>Dark Mode</span>
			{/* Drawn like Coder's Switch; the menu item itself is the control. */}
			<span
				aria-hidden
				className={cn(
					"ml-auto inline-flex h-4 w-7 shrink-0 items-center rounded-full border-2 border-solid border-transparent transition-colors motion-reduce:transition-none",
					isDark ? "bg-surface-invert-primary" : "bg-surface-quaternary",
				)}
			>
				<span
					className={cn(
						"block size-3 rounded-full bg-surface-primary shadow-lg transition-transform motion-reduce:transition-none",
						isDark && "translate-x-3",
					)}
				/>
			</span>
		</DropdownMenuItem>
	);
};
