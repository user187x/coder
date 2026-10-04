import { cn } from "cn";
import { PlayIcon, TimerIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
	BANNER_EFFECTS,
	BANNER_LEVELS,
	type BannerEffect,
	type BannerFields,
	type BannerLevel,
} from "#/api/platform";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { Textarea } from "#/components/Textarea/Textarea";
import { BannerPreview } from "#/modules/platform/announcement/BannerPreview";
import {
	colorsToken,
	LEVEL_COLORS,
	parseColors,
} from "#/modules/platform/announcement/bannerTokens";
import { ColorField } from "#/modules/platform/ColorField";
import { CountdownBuilder } from "./CountdownBuilder";
import { EmojiButton } from "./EmojiButton";

export const MESSAGE_MAX_LENGTH = 400;

const LEVEL_LABELS: Record<BannerLevel, string> = {
	info: "Info",
	success: "Success",
	warning: "Warning",
	critical: "Critical",
};

const EFFECT_OPTIONS: Record<BannerEffect, { label: string; hint: string }> = {
	none: { label: "None", hint: "Plain text, no animation." },
	typewriter: {
		label: "Typewriter",
		hint: "Letters appear one by one, as if typed.",
	},
	fade: { label: "Fade in", hint: "Words fade in one after another." },
	rise: { label: "Rise", hint: "Letters slide up into place." },
	wave: { label: "Wave", hint: "A wave of movement runs through the letters." },
	bounce: { label: "Bounce", hint: "Letters drop in and bounce." },
	flip: { label: "Flip", hint: "Letters flip into view." },
	shake: {
		label: "Shake",
		hint: "The whole message shakes: best kept for urgent notices.",
	},
	pulse: { label: "Pulse", hint: "The message gently pulses." },
	rainbow: { label: "Rainbow", hint: "Colours sweep through the letters." },
};

type Preset = Pick<BannerFields, "level" | "message" | "dismissible">;

const PRESETS: { name: string; preset: Preset; danger?: boolean }[] = [
	{
		name: "Scheduled maintenance",
		preset: {
			level: "warning",
			dismissible: true,
			message:
				"**Scheduled maintenance:** Coder will be unavailable on [date] from [start] to [end] UTC. Please save your work and stop your workspaces beforehand.",
		},
	},
	{
		name: "Emergency patch",
		danger: true,
		preset: {
			level: "critical",
			dismissible: false,
			message:
				"**Emergency security patch:** Coder will restart at [time] UTC to apply a critical security fix. Save your work and push any code you need to keep now.",
		},
	},
	{
		name: "All clear",
		preset: {
			level: "success",
			dismissible: true,
			message:
				"**All clear:** Maintenance is complete and Coder is back to normal. Thanks for your patience.",
		},
	},
];

const BRACKETED = /\[[^\]]+\]/;

/** The message still holds [bracketed] placeholders of a template. */
export const hasPlaceholders = (message: string) => {
	// Links are [text](url): only brackets not followed by "(" are placeholders.
	return BRACKETED.test(message.replace(/\[[^\]]+\]\([^)\s]+\)/g, ""));
};

type BannerEditorProps = {
	form: BannerFields;
	dirty: boolean;
	isPublishing: boolean;
	problem: string | null;
	onChange: (change: Partial<BannerFields>) => void;
	onProblem: (problem: string) => void;
	onPublish: () => void;
	onDiscard: () => void;
};

/**
 * The announcement's message (Markdown, with emoji and a live countdown),
 * its colours, text effect and options. Nothing is published until
 * "Publish changes".
 */
export const BannerEditor: React.FC<BannerEditorProps> = ({
	form,
	dirty,
	isPublishing,
	problem,
	onChange,
	onProblem,
	onPublish,
	onDiscard,
}) => {
	const id = useId();
	const messageRef = useRef<HTMLTextAreaElement>(null);
	const [caret, setCaret] = useState<[number, number] | null>(null);
	const [previewing, setPreviewing] = useState(false);
	const [countdownOpen, setCountdownOpen] = useState(false);
	const customColors = parseColors(form.title);
	const rememberCaret = () => {
		const el = messageRef.current;
		if (el) {
			setCaret([el.selectionStart, el.selectionEnd]);
		}
	};

	const insertAtCaret = (text: string) => {
		const [start, end] = caret ?? [form.message.length, form.message.length];
		const next = form.message.slice(0, start) + text + form.message.slice(end);
		if (next.length > MESSAGE_MAX_LENGTH) {
			onProblem("The message would be too long.");
			return;
		}
		setCaret([start + text.length, start + text.length]);
		onChange({ message: next });
	};

	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="flex flex-col gap-6 rounded-lg border border-solid border-border p-6"
		>
			<h2 id={`${id}-heading`} className="m-0 text-base font-semibold">
				Message
			</h2>

			<div
				role="group"
				aria-label="Start from a template"
				className="flex flex-wrap items-center gap-2"
			>
				<span className="text-sm text-content-secondary">Start from:</span>
				{PRESETS.map(({ name, preset, danger }) => (
					<Button
						key={name}
						size="sm"
						variant={danger ? "destructive" : "outline"}
						onClick={() => {
							// A template's colours are its level's, not custom ones.
							onChange({ ...preset, title: "" });
							messageRef.current?.focus();
						}}
					>
						{name}
					</Button>
				))}
			</div>

			<div className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between">
					<Label htmlFor={`${id}-message`}>Message</Label>
					<span className="text-xs text-content-secondary tabular-nums">
						{form.message.length} / {MESSAGE_MAX_LENGTH}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<EmojiButton onPick={insertAtCaret} />
					<Button
						size="sm"
						variant="outline"
						aria-expanded={countdownOpen}
						onClick={() => setCountdownOpen(!countdownOpen)}
					>
						<TimerIcon />
						Countdown
					</Button>
					<span className="text-xs text-content-secondary">
						Markdown: **bold** *italic* ~~strike~~ `code` [link](https://…)
					</span>
					<span className="flex-1" />
					<div role="group" aria-label="Message view" className="flex gap-1">
						<Button
							size="sm"
							variant={previewing ? "subtle" : "outline"}
							aria-pressed={!previewing}
							onClick={() => {
								setPreviewing(false);
								messageRef.current?.focus();
							}}
						>
							Write
						</Button>
						<Button
							size="sm"
							variant={previewing ? "outline" : "subtle"}
							aria-pressed={previewing}
							onClick={() => setPreviewing(true)}
						>
							Preview
						</Button>
					</div>
				</div>
				{previewing ? (
					<div
						aria-live="polite"
						className="rounded-md bg-surface-secondary p-3"
					>
						{form.message ? (
							<BannerPreview banner={{ ...form, effect: "none" }} />
						) : (
							<p className="m-0 text-sm text-content-secondary">
								Type a message to see a preview.
							</p>
						)}
					</div>
				) : (
					<Textarea
						id={`${id}-message`}
						ref={messageRef}
						rows={3}
						maxLength={MESSAGE_MAX_LENGTH}
						placeholder="What do developers need to know?"
						value={form.message}
						onChange={(event) => onChange({ message: event.target.value })}
						onKeyUp={rememberCaret}
						onClick={rememberCaret}
						onBlur={rememberCaret}
					/>
				)}
				{countdownOpen && (
					<CountdownBuilder
						message={form.message}
						caret={caret}
						maxLength={MESSAGE_MAX_LENGTH}
						onChange={(message) => onChange({ message })}
						onProblem={onProblem}
					/>
				)}
			</div>

			<fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
				<legend className="mb-2 p-0 text-sm font-semibold">Colors</legend>
				<div className="flex flex-wrap gap-2">
					{BANNER_LEVELS.map((level) => {
						const selected = !customColors && form.level === level;
						return (
							<Button
								key={level}
								size="sm"
								variant="outline"
								aria-pressed={selected}
								title={`${LEVEL_LABELS[level]} (${LEVEL_COLORS[level].bg})`}
								className={cn(selected && "ring-2 ring-content-primary")}
								onClick={() => onChange({ level, title: "" })}
							>
								<span
									aria-hidden
									className="size-3 rounded-full"
									style={{ background: LEVEL_COLORS[level].bg }}
								/>
								{LEVEL_LABELS[level]}
							</Button>
						);
					})}
					<Button
						size="sm"
						variant="outline"
						aria-pressed={Boolean(customColors)}
						className={cn(customColors && "ring-2 ring-content-primary")}
						onClick={() => {
							if (!customColors) {
								onChange({
									title: colorsToken({
										bg: LEVEL_COLORS[form.level].bg,
										fg: "#ffffff",
									}),
								});
							}
						}}
					>
						<span
							aria-hidden
							className="size-3 rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]"
						/>
						Custom
					</Button>
				</div>
				{customColors && (
					<div className="grid gap-4 md:grid-cols-2">
						<ColorField
							label="Background"
							value={customColors.bg}
							onChange={(bg) =>
								onChange({ title: colorsToken({ ...customColors, bg }) })
							}
						/>
						<ColorField
							label="Text"
							value={customColors.fg}
							onChange={(fg) =>
								onChange({ title: colorsToken({ ...customColors, fg }) })
							}
						/>
					</div>
				)}
			</fieldset>

			<EffectField form={form} onChange={onChange} />

			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2 text-sm">
					<Checkbox
						id={`${id}-dismissible`}
						checked={form.dismissible}
						onCheckedChange={(checked) =>
							onChange({ dismissible: checked === true })
						}
					/>
					<Label htmlFor={`${id}-dismissible`} className="font-normal">
						Let people dismiss it
						<span className="text-content-secondary">
							(untick for urgent notices)
						</span>
					</Label>
				</div>
				<div className="flex items-center gap-2 text-sm">
					<Checkbox
						id={`${id}-login`}
						checked={form.showOnLoginPage}
						onCheckedChange={(checked) =>
							onChange({ showOnLoginPage: checked === true })
						}
					/>
					<Label htmlFor={`${id}-login`} className="font-normal">
						Also show on the sign-in page
					</Label>
				</div>
			</div>

			<Collapsible>
				<CollapsibleTrigger asChild>
					<Button variant="subtle" size="sm" className="self-start">
						Advanced
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="mt-3 flex flex-col gap-2">
						<Label htmlFor={`${id}-refresh`}>
							Open tabs check for changes every (seconds)
						</Label>
						<Input
							id={`${id}-refresh`}
							type="number"
							min={15}
							max={3600}
							step={5}
							className="w-32"
							value={form.refreshSeconds}
							onChange={(event) => {
								const seconds = Number.parseInt(event.target.value, 10);
								onChange({
									refreshSeconds: Number.isFinite(seconds) ? seconds : 60,
								});
							}}
						/>
						<p className="m-0 text-sm text-content-secondary">
							Lower is faster to reach people who already have Coder open
							(minimum 15). Tabs with a live connection update instantly.
						</p>
					</div>
				</CollapsibleContent>
			</Collapsible>

			{problem && (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{problem}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-3">
				<Button
					disabled={isPublishing || !dirty || !form.message}
					onClick={onPublish}
				>
					<Spinner loading={isPublishing} />
					Publish changes
				</Button>
				<Button
					variant="outline"
					disabled={isPublishing || !dirty}
					onClick={onDiscard}
				>
					Discard edits
				</Button>
				<span aria-live="polite" className="text-sm text-content-secondary">
					{dirty
						? "You have unpublished changes."
						: hasPlaceholders(form.message)
							? "Replace the [bracketed] parts of the message before publishing."
							: ""}
				</span>
			</div>
		</section>
	);
};

type EffectFieldProps = {
	form: BannerFields;
	onChange: (change: Partial<BannerFields>) => void;
};

const EffectField: React.FC<EffectFieldProps> = ({ form, onChange }) => {
	const id = useId();
	const [replay, setReplay] = useState(0);
	const reducedMotion =
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

	return (
		<fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
			<legend className="mb-2 p-0 text-sm font-semibold">Text effect</legend>
			<div className="flex flex-wrap items-center gap-4">
				<Select
					value={form.effect}
					onValueChange={(value) => {
						const effect = BANNER_EFFECTS.find((e) => e === value);
						if (effect) {
							onChange({ effect });
							setReplay((n) => n + 1);
						}
					}}
				>
					<SelectTrigger
						className="w-48"
						aria-label="Text effect"
						aria-describedby={`${id}-hint`}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{BANNER_EFFECTS.map((effect) => (
							<SelectItem key={effect} value={effect}>
								{EFFECT_OPTIONS[effect].label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div className="flex items-center gap-2 text-sm">
					<Checkbox
						id={`${id}-repeat`}
						disabled={form.effect === "none"}
						checked={form.repeat}
						onCheckedChange={(checked) =>
							onChange({ repeat: checked === true })
						}
					/>
					<Label htmlFor={`${id}-repeat`} className="font-normal">
						Repeat continuously
					</Label>
				</div>
				<Button
					size="sm"
					variant="outline"
					disabled={form.effect === "none" || !form.message}
					onClick={() => setReplay((n) => n + 1)}
				>
					<PlayIcon />
					Replay
				</Button>
			</div>
			<p id={`${id}-hint`} className="m-0 text-sm text-content-secondary">
				{EFFECT_OPTIONS[form.effect].hint}
				{form.repeat ? "" : " It plays once when the banner appears."}
				{reducedMotion &&
					" This device asks for reduced motion, so effects are not played here, or for anyone with that setting."}
			</p>
			{form.effect !== "none" && form.message && (
				<BannerPreview key={replay} banner={form} animate />
			)}
		</fieldset>
	);
};
