import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { PanelAccent, UserUIPreferences } from "#/api/platform";
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
import { PANEL_SCALE } from "#/modules/platform/panelAccent/PanelAccent";
import { PanelColorPreview } from "./PanelColorPreview";

const DEFAULT_CUSTOM = "#7c3aed";
const DEFAULT_TEXT = "#e4e4e7";
const DEFAULT_CARD = "#e4e7eb";
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
	const savedCard = preferences.data?.panel_card_color ?? null;
	const [card, setCard] = useState(savedCard ?? DEFAULT_CARD);
	useEffect(() => {
		if (savedCard) setCard(savedCard);
	}, [savedCard]);
	const savedScale = preferences.data?.panel_scale ?? PANEL_SCALE.default;
	const [scale, setScale] = useState(savedScale);
	useEffect(() => setScale(savedScale), [savedScale]);
	// Everyone's when Global is on (admins), else the user's own.
	const apply = (next: PanelAccent | null) =>
		isGlobal
			? saveGlobal.mutate(next ?? null)
			: save.mutate({ panel_accent: next });
	const pending = useRef<{
		preferences?: ReturnType<typeof setTimeout>;
		global?: ReturnType<typeof setTimeout>;
	}>({});
	const changes = useRef<UserUIPreferences>({});
	const later = (patch: UserUIPreferences) => {
		Object.assign(changes.current, patch);
		clearTimeout(pending.current.preferences);
		pending.current.preferences = setTimeout(() => {
			save.mutate(changes.current);
			changes.current = {};
		}, SAVE_DELAY_MS);
	};
	useEffect(() => {
		const timers = pending.current;
		return () => Object.values(timers).forEach((timer) => clearTimeout(timer));
	}, []);
	// An admin's Global accent decides for everyone else: they see it, without changing it.
	const locked = isGlobal && !admin;
	const busy = preferences.isLoading || save.isPending || saveGlobal.isPending;
	const previewAccent = accentFor(mode, color);
	const pickAccent = (value: string) => {
		setColor(value);
		const next: PanelAccent = { mode: "custom", color: value };
		if (isGlobal) {
			clearTimeout(pending.current.global);
			pending.current.global = setTimeout(
				() => saveGlobal.mutate(next),
				SAVE_DELAY_MS,
			);
		} else {
			later({ panel_accent: next });
		}
	};
	const pickText = (value: string) => {
		setText(value);
		later({ panel_text_color: value });
	};
	const pickCard = (value: string) => {
		setCard(value);
		later({ panel_card_color: value });
	};

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
								onChange={pickAccent}
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
									Set the accent for every user. Use the preview to set
									individual colours.
								</span>
							</span>
						</div>
					)}
					<div className="flex flex-col gap-3">
						<Label htmlFor={`${id}-text`}>Text</Label>
						<Select
							value={
								savedText || globalQuery.data?.colors?.text ? "custom" : "theme"
							}
							disabled={busy || Boolean(globalQuery.data?.colors?.text)}
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
						{savedText && !globalQuery.data?.colors?.text && (
							<ColorField
								label="Text colour"
								value={text}
								onChange={pickText}
							/>
						)}
					</div>
					<div className="flex flex-col gap-3">
						<Label htmlFor={`${id}-card`}>Card panels</Label>
						<Select
							value={
								savedCard || globalQuery.data?.colors?.backdrop
									? "custom"
									: "theme"
							}
							disabled={busy || Boolean(globalQuery.data?.colors?.backdrop)}
							onValueChange={(value) =>
								save.mutate({
									panel_card_color: value === "custom" ? card : null,
								})
							}
						>
							<SelectTrigger id={`${id}-card`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="theme">Theme's</SelectItem>
								<SelectItem value="custom">Custom colour</SelectItem>
							</SelectContent>
						</Select>
						<span className="text-xs text-content-secondary">
							The background of the rounded panels that hold the cards
							throughout the app: the Dashboard, Workspaces, Templates,
							Accounts, the Chat console, User Settings and Appearance.
						</span>
						{savedCard && !globalQuery.data?.colors?.backdrop && (
							<ColorField
								label="Card panel colour"
								value={card}
								onChange={pickCard}
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
									later({
										panel_scale: next === PANEL_SCALE.default ? null : next,
									});
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
				<PanelColorPreview
					admin={admin}
					accent={previewAccent}
					scale={scale}
					text={savedText ? text : null}
					backdrop={savedCard ? card : null}
				/>
			</div>
		</section>
	);
};
