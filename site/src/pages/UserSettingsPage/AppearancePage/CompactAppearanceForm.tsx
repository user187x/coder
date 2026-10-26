import { useId, useState } from "react";
import type {
	UpdateUserAppearanceSettingsRequest,
	UserAppearanceSettings,
} from "#/api/typesGenerated";
import { TerminalFontNames } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { ColorField } from "#/modules/platform/ColorField";
import themes, { CONCRETE_THEMES, isConcreteThemeName } from "#/theme";
import { DEFAULT_TERMINAL_FONT, terminalFontLabels } from "#/theme/constants";
import {
	type CustomTheme,
	customThemeStyle,
	encodeCustomTheme,
	parseCustomTheme,
} from "#/theme/customTheme";
import {
	draftFromState,
	draftToUpdate,
	migrateLegacyPreference,
} from "#/theme/themeMode";
import { ThemePreview } from "./ThemePreview";
import { THEME_COPY } from "./themeCopy";

export const CompactAppearanceForm = ({
	initialValues,
	activeScheme,
	onSubmit,
	isUpdating,
	error,
}: {
	initialValues: UserAppearanceSettings;
	activeScheme: "dark" | "light";
	onSubmit: (settings: UpdateUserAppearanceSettingsRequest) => void;
	isUpdating?: boolean;
	error?: unknown;
}) => {
	const id = useId();
	const [draft, setDraft] = useState(() =>
		draftFromState(migrateLegacyPreference(initialValues), {
			light: initialValues.theme_light,
			dark: initialValues.theme_dark,
		}),
	);
	const [custom, setCustom] = useState(() =>
		parseCustomTheme(initialValues.theme_preference),
	);
	const [font, setFont] = useState(
		initialValues.terminal_font || DEFAULT_TERMINAL_FONT,
	);
	const [slot, setSlot] = useState<"light" | "dark">(activeScheme);
	const selected = draft.mode === "single" ? draft.single : draft[slot];
	const base = themes[selected].palette;
	const colors: CustomTheme = custom ?? {
		base: selected,
		background: base.background.default,
		surface: base.background.paper,
		text: base.text.primary,
		accent: base.primary.main,
		border: selected.startsWith("dark") ? "#3f3f46" : "#d4d4d8",
	};
	const previewStyle =
		custom && draft.mode === "single"
			? {
					...customThemeStyle(custom),
					"--git-added": customThemeStyle(custom)["--content-link"],
				}
			: undefined;
	const request = draftToUpdate(draft, font, activeScheme);
	if (custom && draft.mode === "single")
		request.theme_preference = encodeCustomTheme(custom);
	return (
		<section
			className="rounded-lg border border-solid border-border p-4"
			aria-label="Your theme and terminal font"
		>
			{Boolean(error) && <ErrorAlert error={error} />}
			<div className="mb-4">
				<h2 className="m-0 text-lg font-semibold">Your theme</h2>
				<p className="m-0 text-sm text-content-secondary">
					Preview your theme and colors before saving. These settings apply to
					your account.
				</p>
			</div>
			<div className="grid gap-5 lg:grid-cols-2">
				<div className="flex flex-col gap-3">
					<Label htmlFor={`${id}-mode`}>Theme mode</Label>
					<Select
						value={draft.mode}
						onValueChange={(value) => {
							if (value === "single" || value === "sync") {
								setDraft({
									...draft,
									mode: value,
									single:
										value === "single" && draft.mode === "sync"
											? draft[activeScheme]
											: draft.single,
								});
								setCustom(undefined);
							}
						}}
					>
						<SelectTrigger id={`${id}-mode`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="single">Single theme</SelectItem>
							<SelectItem value="sync">Sync with system</SelectItem>
						</SelectContent>
					</Select>
					{draft.mode === "sync" && (
						<div
							className="flex gap-2"
							role="group"
							aria-label="System theme to edit"
						>
							{(["light", "dark"] as const).map((value) => (
								<Button
									key={value}
									type="button"
									variant={slot === value ? "default" : "outline"}
									onClick={() => setSlot(value)}
									aria-pressed={slot === value}
								>
									{value === "light" ? "Light theme" : "Dark theme"}
								</Button>
							))}
						</div>
					)}
					<Label htmlFor={`${id}-theme`}>Theme selection</Label>
					<Select
						value={custom && draft.mode === "single" ? "custom" : selected}
						onValueChange={(value) => {
							if (value === "custom") {
								setCustom(colors);
								return;
							}
							if (!isConcreteThemeName(value)) return;
							setCustom(undefined);
							setDraft(
								draft.mode === "single"
									? { ...draft, single: value }
									: { ...draft, [slot]: value },
							);
						}}
					>
						<SelectTrigger id={`${id}-theme`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CONCRETE_THEMES.filter(
								(theme) => draft.mode === "single" || theme.startsWith(slot),
							).map((theme) => (
								<SelectItem key={theme} value={theme}>
									{THEME_COPY[theme].title}
								</SelectItem>
							))}
							{draft.mode === "single" && (
								<SelectItem value="custom">Custom colors</SelectItem>
							)}
						</SelectContent>
					</Select>
					{custom && draft.mode === "single" && (
						<div className="grid grid-cols-2 gap-3">
							{(
								[
									["background", "Background"],
									["surface", "Panels"],
									["text", "Text"],
									["accent", "Accent"],
									["border", "Borders"],
								] as const
							).map(([key, label]) => (
								<ColorField
									key={key}
									label={label}
									value={custom[key]}
									onChange={(value) => setCustom({ ...custom, [key]: value })}
								/>
							))}
						</div>
					)}
					<Label htmlFor={`${id}-font`}>Terminal font</Label>
					<Select
						value={font}
						onValueChange={(value) => {
							const name = TerminalFontNames.find((name) => name === value);
							if (name) setFont(name);
						}}
					>
						<SelectTrigger id={`${id}-font`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TerminalFontNames.filter((name) => name !== "").map((name) => (
								<SelectItem key={name} value={name}>
									{terminalFontLabels[name]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						type="button"
						disabled={isUpdating}
						onClick={() => onSubmit(request)}
					>
						Save theme
					</Button>
				</div>
				<div className="flex flex-col gap-3">
					<h3 className="m-0 text-sm font-medium">Preview</h3>
					<ThemePreview theme={selected} size="lg" style={previewStyle} />
					<p className="m-0 text-xs text-content-secondary">
						{custom ? "Custom colors" : THEME_COPY[selected].description}
					</p>
				</div>
			</div>
		</section>
	);
};
