import {
	ChevronDownIcon,
	GaugeIcon,
	MonitorIcon,
	PanelRightCloseIcon,
	RadioIcon,
	SettingsIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { PanelAccent } from "#/api/platform";
import {
	panelAccentGlobal,
	updatePanelAccentGlobal,
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Slider } from "#/components/Slider/Slider";
import { Switch } from "#/components/Switch/Switch";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { ColorField } from "#/modules/platform/ColorField";
import {
	PANEL_SCALE,
	panelAccentColor,
	panelTextTokens,
} from "#/modules/platform/panelAccent/PanelAccent";

const DEFAULT_CUSTOM = "#7c3aed";
const DEFAULT_TEXT = "#e4e4e7";
/** How long a picker or slider rests before its value is saved. */
const SAVE_DELAY_MS = 400;
type Mode = "off" | PanelAccent["mode"];

const accentFor = (mode: Mode, color: string): PanelAccent | null =>
	mode === "off"
		? null
		: mode === "theme"
			? { mode: "theme" }
			: { mode: "custom", color };

/**
 * Appearance > Panel accents: the inner containers of the Settings menu and panel and of the chat (floating or
 * docked) take the theme's accent colour, a colour of their own, or none, and the panels can be drawn larger or
 * smaller, as the browser's zoom would. Settings on the left, the Settings panel as it will look on the right.
 * Global (admins): the accent is set for everyone.
 */
export const PanelAccentSection: React.FC<{
	/** Inside the Your theme card: its part below a divider, no card of its own. */
	embedded?: boolean;
}> = ({ embedded = false }) => {
	const id = useId();
	const queryClient = useQueryClient();
	const { permissions } = useAuthenticated();
	const admin = Boolean(permissions.editDeploymentConfig);
	const preferences = useQuery(userUIPreferences());
	const globalQuery = useQuery(panelAccentGlobal());
	const save = useMutation(updateUserUIPreferences(queryClient));
	const saveGlobal = useMutation(updatePanelAccentGlobal(queryClient));
	const globalAccent = globalQuery.data?.global ?? null;
	const isGlobal = globalAccent !== null;
	const accent = globalAccent ?? preferences.data?.panel_accent ?? null;
	const mode: Mode = accent?.mode ?? "off";
	const savedColor = accent?.mode === "custom" ? accent.color : null;
	const [color, setColor] = useState(savedColor ?? DEFAULT_CUSTOM);
	// The saved colour once the preferences arrive (or change elsewhere)
	useEffect(() => {
		if (savedColor) setColor(savedColor);
	}, [savedColor]);
	const savedText = preferences.data?.panel_text_color ?? null;
	const [text, setText] = useState(savedText ?? DEFAULT_TEXT);
	useEffect(() => {
		if (savedText) setText(savedText);
	}, [savedText]);
	const savedScale = preferences.data?.panel_scale ?? PANEL_SCALE.default;
	const [scale, setScale] = useState(savedScale);
	useEffect(() => setScale(savedScale), [savedScale]);
	// Everyone's when Global is on (admins), else the user's own.
	const apply = (next: PanelAccent | null) =>
		isGlobal
			? saveGlobal.mutate(next ?? null)
			: save.mutate({ panel_accent: next });
	const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
	const later = (action: () => void) => {
		clearTimeout(pending.current);
		pending.current = setTimeout(action, SAVE_DELAY_MS);
	};
	useEffect(() => () => clearTimeout(pending.current), []);
	// An admin's Global accent decides for everyone else: they see it, without changing it.
	const locked = isGlobal && !admin;
	const busy = preferences.isLoading || save.isPending || saveGlobal.isPending;
	const previewAccent = accentFor(mode, color);

	return (
		<section
			className={
				embedded
					? "mt-6 border-0 border-t border-solid border-border pt-6"
					: "mt-6 rounded-xl border border-solid border-border bg-surface-primary p-6"
			}
			aria-labelledby={`${id}-title`}
		>
			{Boolean(save.error) && <ErrorAlert error={save.error} />}
			{Boolean(saveGlobal.error) && <ErrorAlert error={saveGlobal.error} />}
			{embedded ? (
				<h3 id={`${id}-title`} className="m-0 text-base font-semibold">
					Panel accents
				</h3>
			) : (
				<h2 id={`${id}-title`} className="m-0 text-lg font-semibold">
					Panel accents
				</h2>
			)}
			<p className="mt-0 mb-4 text-sm text-content-secondary">
				Colour the cards and rows inside the Settings menu and side panel and
				the chat, floating or docked, set their text colour, and set how large
				those panels are drawn.
			</p>
			<div className="grid gap-6 lg:grid-cols-2">
				<div className="flex min-w-0 flex-col gap-4">
					<div className="flex flex-col gap-3">
						<Label htmlFor={`${id}-mode`}>Accent</Label>
						<Select
							value={mode}
							disabled={busy || locked}
							onValueChange={(value) => {
								if (value === "off" || value === "theme" || value === "custom")
									apply(accentFor(value, color));
							}}
						>
							<SelectTrigger id={`${id}-mode`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="off">None</SelectItem>
								<SelectItem value="theme">Follow theme</SelectItem>
								<SelectItem value="custom">Custom colour</SelectItem>
							</SelectContent>
						</Select>
						{mode === "custom" && !locked && (
							<ColorField
								label="Accent colour"
								value={color}
								onChange={(value) => {
									setColor(value);
									later(() => apply({ mode: "custom", color: value }));
								}}
							/>
						)}
						{locked && (
							<p className="m-0 text-xs text-content-secondary">
								An administrator set the panel accent for everyone.
							</p>
						)}
					</div>
					{admin && (
						<div className="flex items-start gap-3">
							<Switch
								id={`${id}-global`}
								checked={isGlobal}
								disabled={busy}
								onCheckedChange={(on) =>
									saveGlobal.mutate(
										on
											? accentFor(mode === "off" ? "theme" : mode, color)
											: null,
									)
								}
							/>
							<span className="flex flex-col">
								<Label htmlFor={`${id}-global`}>Global</Label>
								<span className="text-xs text-content-secondary">
									Set this accent for every user, over their own choice.
								</span>
							</span>
						</div>
					)}
					<div className="flex flex-col gap-3">
						<Label htmlFor={`${id}-text`}>Text</Label>
						<Select
							value={savedText ? "custom" : "theme"}
							disabled={busy}
							onValueChange={(value) =>
								save.mutate({
									panel_text_color: value === "custom" ? text : null,
								})
							}
						>
							<SelectTrigger id={`${id}-text`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="theme">Theme's</SelectItem>
								<SelectItem value="custom">Custom colour</SelectItem>
							</SelectContent>
						</Select>
						{savedText && (
							<ColorField
								label="Text colour"
								value={text}
								onChange={(value) => {
									setText(value);
									later(() => save.mutate({ panel_text_color: value }));
								}}
							/>
						)}
					</div>
					<div className="flex flex-col gap-2">
						<span id={`${id}-size`} className="text-sm font-medium">
							Panel size
						</span>
						<div className="flex items-center gap-3">
							<Slider
								className="w-56"
								min={PANEL_SCALE.min}
								max={PANEL_SCALE.max}
								step={PANEL_SCALE.step}
								value={[scale]}
								disabled={busy}
								aria-labelledby={`${id}-size`}
								onValueChange={([next]) => {
									if (next === undefined) return;
									setScale(next);
									later(() =>
										save.mutate({
											panel_scale: next === PANEL_SCALE.default ? null : next,
										}),
									);
								}}
							/>
							<span className="w-12 text-sm tabular-nums text-content-secondary">
								{scale}%
							</span>
						</div>
						<span className="text-xs text-content-secondary">
							Larger or smaller, as the browser's zoom would draw them, the rest
							of the page as it is.
						</span>
					</div>
				</div>
				<div
					role="group"
					aria-label="Panel preview"
					className="flex min-w-0 flex-col gap-2"
				>
					<span className="text-sm font-medium">Preview</span>
					<div className="flex min-h-72 items-start justify-center overflow-hidden rounded-xl bg-surface-tertiary p-4">
						<SettingsPanelPreview
							accent={previewAccent}
							scale={scale}
							text={savedText ? text : null}
						/>
					</div>
				</div>
			</div>
		</section>
	);
};

/** The Settings panel's look, its accent and size applied, for the preview: its controls are pictures only. */
const SettingsPanelPreview: React.FC<{
	accent: PanelAccent | null;
	scale: number;
	text: string | null;
}> = ({ accent, scale, text }) => (
	<div
		aria-hidden
		data-testid="panel-preview"
		data-panel-accent-preview={accent ? "" : undefined}
		data-panel-text-preview={text ? "" : undefined}
		className="w-64 shrink-0 rounded-2xl border border-solid border-border bg-surface-primary p-2 text-xs shadow-md"
		style={
			{
				zoom: scale / 100,
				...(accent ? { "--panel-accent": panelAccentColor(accent) } : {}),
				...(text
					? {
							"--panel-text-primary": panelTextTokens(text).primary,
							"--panel-text-secondary": panelTextTokens(text).secondary,
						}
					: {}),
			} as React.CSSProperties
		}
	>
		<div className="mb-2 flex items-center justify-between px-1 text-content-secondary">
			<span className="inline-flex items-center gap-1.5 font-medium text-content-primary">
				<SettingsIcon className="size-3.5" />
				Settings
			</span>
			<ChevronDownIcon className="size-3.5" />
		</div>
		<div className="mb-1 flex gap-1">
			<span className="flex min-h-7 flex-[2] items-center justify-center gap-1 rounded-full border border-solid border-border">
				<GaugeIcon className="size-3.5" />
				HUD
			</span>
			<span className="flex min-h-7 flex-1 items-center justify-center rounded-full border border-solid border-border">
				<PanelRightCloseIcon className="size-3.5" />
			</span>
		</div>
		<div className="flex items-center justify-between px-2 py-1.5 text-content-secondary">
			<span className="inline-flex items-center gap-1.5">
				<RadioIcon className="size-3.5" />
				Region
			</span>
			Default
		</div>
		<span className="mb-2 flex min-h-7 items-center justify-center gap-1.5 rounded-full border border-solid border-border font-medium">
			<MonitorIcon className="size-3.5" />
			Workspaces
		</span>
		<div className="flex flex-col gap-2 rounded-lg border border-solid border-border p-2 bg-surface-primary">
			<span className="font-semibold">Cluster</span>
			{[
				["CPU", "40%", "w-2/5"],
				["Memory", "73%", "w-3/4"],
			].map(([label, value, width]) => (
				<div key={label} className="flex flex-col gap-1">
					<span className="flex justify-between text-content-secondary">
						{label}
						<span>{value}</span>
					</span>
					<span className="h-1.5 rounded-full bg-surface-quaternary">
						<span
							className={`block h-full rounded-full bg-content-success ${width}`}
						/>
					</span>
				</div>
			))}
		</div>
	</div>
);
