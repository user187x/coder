import { cn } from "cn";
import { ChevronDownIcon, MoonIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	appearanceSettings,
	updateAppearanceSettings,
} from "#/api/queries/users";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { ThemeColorCircle } from "#/pages/UserSettingsPage/AppearancePage/ThemeSwatch";
import { THEME_COPY } from "#/pages/UserSettingsPage/AppearancePage/themeCopy";
import type { ConcreteThemeName } from "#/theme";
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
	const [expanded, setExpanded] = useState(false);
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

	const choose = (theme: ConcreteThemeName) =>
		updateAppearance.mutate({
			theme_preference: theme,
			theme_mode: "single",
			theme_light: settings?.theme_light || "light",
			theme_dark: settings?.theme_dark || "dark",
			terminal_font: settings?.terminal_font || DEFAULT_TERMINAL_FONT,
		});
	return (
		<>
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
			<DropdownMenuItem
				aria-expanded={expanded}
				onSelect={(event) => {
					event.preventDefault();
					setExpanded(!expanded);
				}}
			>
				<span>Theme colors</span>
				<ChevronDownIcon className="ml-auto size-4" />
			</DropdownMenuItem>
			{updateAppearance.error && <ErrorAlert error={updateAppearance.error} />}
			{expanded && (
				<fieldset
					disabled={updateAppearance.isPending}
					className="m-0 flex flex-col gap-3 border-0 px-3 py-2"
				>
					<legend className="sr-only">Theme colors</legend>
					{(["dark", "light"] as const).map((mode) => (
						<div key={mode} className="flex items-center justify-between gap-2">
							<span className="text-xs capitalize">{mode} theme</span>
							<div className="flex gap-2">
								{([`${mode}-protan-deuter`, `${mode}-tritan`] as const).map(
									(theme) => (
										<DropdownMenuItem
											key={theme}
											role="menuitemradio"
											aria-label={THEME_COPY[theme].title}
											aria-checked={activeTheme === theme}
											title={THEME_COPY[theme].title}
											disabled={updateAppearance.isPending}
											className={cn(
												"size-8 rounded-full border-2 border-solid p-0.5",
												activeTheme === theme
													? "border-content-link"
													: "border-border",
											)}
											onSelect={(event) => {
												event.preventDefault();
												choose(theme);
											}}
										>
											<ThemeColorCircle theme={theme} />
										</DropdownMenuItem>
									),
								)}
							</div>
						</div>
					))}
				</fieldset>
			)}
		</>
	);
};
