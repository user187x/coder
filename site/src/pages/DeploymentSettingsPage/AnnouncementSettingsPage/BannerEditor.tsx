import {
	AlignCenterIcon,
	AlignLeftIcon,
	AlignRightIcon,
	ChevronDownIcon,
	EyeIcon,
	type LucideIcon,
	PencilIcon,
	PlayIcon,
	Repeat2Icon,
	TimerIcon,
	TypeOutlineIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import {
	BANNER_ALIGNS,
	BANNER_CLOSE_EFFECTS,
	BANNER_EFFECTS,
	BANNER_FONTS,
	BANNER_LEVELS,
	BANNER_OPEN_EFFECTS,
	BANNER_SPEEDS,
	type BannerAlign,
	type BannerCloseEffect,
	type BannerEffect,
	type BannerFields,
	type BannerFont,
	type BannerOpenEffect,
	type BannerSpeed,
	CRAWL_SPEED,
	CRAWL_TILT,
} from "#/api/platform";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Slider } from "#/components/Slider/Slider";
import { Spinner } from "#/components/Spinner/Spinner";
import { Textarea } from "#/components/Textarea/Textarea";
import { bannerColors } from "#/modules/platform/announcement/AnnouncementBanner";
import { CLOSE_EFFECT_OPTIONS } from "#/modules/platform/announcement/bannerClose";
import {
	BANNER_FONT_OPTIONS,
	bannerFontStack,
} from "#/modules/platform/announcement/bannerFonts";
import { OPEN_EFFECT_OPTIONS } from "#/modules/platform/announcement/bannerOpen";
import {
	colorsToken,
	hasContent,
	LEVEL_COLORS,
	utcSeconds,
} from "#/modules/platform/announcement/bannerTokens";
import { ColorField, type ColorPreset } from "#/modules/platform/ColorField";
import {
	ChosenImage,
	PictureFitSelect,
	UploadImageButton,
} from "./BackgroundPicture";
import { EmojiButton } from "./EmojiButton";

// Long broadcasts are what the crawl and the banner's scroll-down view are for.
export const MESSAGE_MAX_LENGTH = 4000;

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
	starwars: {
		label: "Star Wars crawl",
		hint: "The message rises from the bottom of the banner to its top at a steady pace, within the banner as it stands, for long broadcasts; its convergence tilts the lines away like the opening crawl, or keeps them a flat scroller. Developers can also read it at once in the banner's scroll-down view.",
	},
	pewpew: {
		label: "Pew-Pew",
		hint: "Each letter fires in as a laser bolt, flashes white on impact with a spark, recoils and settles into a faint glow.",
	},
	flap: {
		label: "Split-Flap",
		hint: "A departure board: every letter on its own plate, flipping over.",
	},
	shimmer: {
		label: "Ghostwrite",
		hint: "Muted letters with a soft band of light sweeping across them.",
	},
	kitt: {
		label: "Knight Rider",
		hint: "KITT's scanner: a red light sweeps back and forth across the banner, its trail fading behind it.",
	},
};

const SPEED_LABELS: Record<BannerSpeed, string> = {
	slow: "Slow",
	normal: "Normal",
	fast: "Fast",
};

const ALIGN_OPTIONS: Record<BannerAlign, { label: string; icon: LucideIcon }> =
	{
		left: { label: "Left", icon: AlignLeftIcon },
		center: { label: "Center", icon: AlignCenterIcon },
		right: { label: "Right", icon: AlignRightIcon },
	};

const LEVEL_NAMES = {
	info: "Info blue",
	success: "Success green",
	warning: "Warning amber",
	critical: "Critical red",
} as const;

/** The banner's colour: its level's colours first (they keep the level), then a few more. */
const BANNER_COLOR_PRESETS: readonly ColorPreset[] = [
	...BANNER_LEVELS.map((level) => ({
		name: LEVEL_NAMES[level],
		value: LEVEL_COLORS[level].bg,
	})),
	{ name: "Violet", value: "#6d28d9" },
	{ name: "Slate", value: "#334155" },
	{ name: "Black", value: "#111111" },
];

/** The text's colour, lit on the banner's dark screen (a dark one falls back to the banner's colour or white). */
const TEXT_COLOR_PRESETS: readonly ColorPreset[] = [
	{ name: "White", value: "#ffffff" },
	{ name: "Yellow", value: "#fde047" },
	{ name: "Amber", value: "#fbbf24" },
	{ name: "Green", value: "#86efac" },
	{ name: "Cyan", value: "#67e8f9" },
	{ name: "Pink", value: "#f9a8d4" },
];

/**
 * The banner's and the text's colours as the banner service keeps them: a
 * level's own pair is that level (no custom colours), any other pair the
 * colours token.
 */
const colorsChange = (bg: string, fg: string): Partial<BannerFields> => {
	const level = BANNER_LEVELS.find(
		(l) =>
			LEVEL_COLORS[l].bg === bg.toLowerCase() &&
			LEVEL_COLORS[l].fg === fg.toLowerCase(),
	);
	return level ? { level, title: "" } : { title: colorsToken({ bg, fg }) };
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A UTC moment as a datetime-local input shows it, in this browser's time zone. */
const toLocalInput = (iso: string): string => {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const nextHour = (): string => {
	const soon = new Date(Date.now() + 3600e3);
	soon.setMinutes(0, 0, 0);
	return utcSeconds(soon);
};

type BannerEditorProps = {
	preview?: React.ReactNode;
	previewing?: boolean;
	onPreviewChange?: (previewing: boolean) => void;
	form: BannerFields;
	dirty: boolean;
	isPublishing: boolean;
	problem: string | null;
	onChange: (change: Partial<BannerFields>) => void;
	onProblem: (problem: string) => void;
	onPublish: () => void;
	onDiscard: () => void;
	/** Plays the open transition on the draft preview. */
	onTryOpen: () => void;
	/** Plays the close transition on the draft preview. */
	onTryClose: () => void;
};

/** Edits remain local until Publish changes; the preview uses the same draft. */
export const BannerEditor: React.FC<BannerEditorProps> = ({
	preview,
	previewing = false,
	onPreviewChange,
	form,
	dirty,
	isPublishing,
	problem,
	onChange,
	onProblem,
	onPublish,
	onDiscard,
	onTryOpen,
	onTryClose,
}) => {
	const id = useId();
	const messageRef = useRef<HTMLTextAreaElement>(null);
	const [caret, setCaret] = useState<[number, number] | null>(null);
	const { bg, fg } = bannerColors(form);
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
			className="relative flex flex-col gap-6 rounded-xl border border-solid border-border bg-surface-primary p-4 shadow-sm sm:p-6"
		>
			<h2
				id={`${id}-heading`}
				className="m-0 border-0 border-b border-solid border-border pb-4 text-base font-semibold"
			>
				Message
			</h2>

			<fieldset
				className="m-0 min-w-0 overflow-hidden rounded-lg border border-solid border-border bg-surface-primary p-0 focus-within:border-content-secondary"
				data-testid="announcement-compose"
			>
				<legend className="sr-only">Compose</legend>
				<div
					role="toolbar"
					aria-label="Text"
					className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border bg-surface-secondary p-3"
				>
					<FontPicker form={form} onChange={onChange} />
					<OutlineButton
						on={form.outline === true}
						onChange={(outline) => onChange({ outline })}
					/>
					<EffectPicker form={form} onChange={onChange} />
					<Button
						size="sm"
						variant={form.loopText !== false ? "default" : "outline"}
						className="h-8 text-xs"
						aria-pressed={form.loopText !== false}
						aria-label="Loop text continuously"
						title="Keep overflowing text moving from the end back to the beginning. Hold the banner to pause."
						onClick={() => onChange({ loopText: form.loopText === false })}
					>
						<Repeat2Icon aria-hidden />
						Loop text
					</Button>
					<ColorButton
						label="Text color"
						short="Text"
						value={fg}
						presets={TEXT_COLOR_PRESETS}
						onChange={(next) => onChange(colorsChange(bg, next))}
					/>
					<ColorButton
						label="Banner color"
						short="Banner"
						value={bg}
						presets={BANNER_COLOR_PRESETS}
						onChange={(next) => onChange(colorsChange(next, fg))}
					/>
					<EmojiButton onPick={insertAtCaret} />
					<AlignButton
						value={form.align ?? "center"}
						onChange={(align) => onChange({ align })}
					/>
				</div>
				<div
					role="toolbar"
					aria-label="Background image"
					className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border bg-surface-secondary p-3"
				>
					<UploadImageButton
						onChange={(picture) => onChange({ picture })}
						onProblem={onProblem}
					/>
					<PictureFitSelect
						value={form.pictureFit ?? "span"}
						disabled={!form.picture}
						onChange={(pictureFit) => onChange({ pictureFit })}
					/>
					{form.picture && (
						<ChosenImage
							picture={form.picture}
							onRemove={() => onChange({ picture: "" })}
						/>
					)}
					<CrawlSlider
						label="Transparency"
						value={100 - (form.opacity || 100)}
						min={0}
						max={100 - MIN_OPACITY}
						unit="%"
						hint="How much of the page shows through the banner's background (and its scroll view's); the text stays solid."
						onChange={(transparency) =>
							onChange({ opacity: 100 - transparency })
						}
					/>
				</div>
				<div className="border-0 border-b border-solid border-border bg-surface-secondary p-3">
					<CountdownField
						value={form.countdown ?? ""}
						onChange={(countdown) => onChange({ countdown })}
					/>
				</div>
				<div className="flex flex-col gap-3 p-4">
					<div className="flex items-baseline justify-between">
						<Label htmlFor={previewing ? undefined : `${id}-message`}>
							{previewing ? "Preview" : "Text"}
						</Label>
						{preview && (
							<Button
								variant="subtle"
								size="sm"
								className="ml-auto mr-3"
								aria-pressed={previewing}
								onClick={() => onPreviewChange?.(!previewing)}
							>
								{previewing ? <PencilIcon /> : <EyeIcon />}
								{previewing ? "Edit message" : "Preview"}
							</Button>
						)}
						<span className="text-xs text-content-secondary tabular-nums">
							{form.message.length} / {MESSAGE_MAX_LENGTH}
						</span>
					</div>
					{previewing ? (
						preview
					) : (
						<Textarea
							id={`${id}-message`}
							ref={messageRef}
							// Platform: the Show banner switch takes the admin here when there is nothing to show
							data-banner-message=""
							rows={6}
							className="min-h-40 resize-y border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
							maxLength={MESSAGE_MAX_LENGTH}
							placeholder="What do developers need to know?"
							value={form.message}
							// As it will look: in the banner's font, lined up as chosen.
							style={{
								fontFamily: bannerFontStack(form.font),
								textAlign: form.align ?? "center",
							}}
							onChange={(event) => onChange({ message: event.target.value })}
							onKeyUp={rememberCaret}
							onClick={rememberCaret}
							onBlur={rememberCaret}
						/>
					)}
				</div>
			</fieldset>

			<fieldset
				className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border border-solid border-border bg-surface-secondary p-4 sm:p-6"
				data-testid="announcement-controls"
			>
				<legend className="sr-only">Controls</legend>
				<h3 className="m-0 text-sm font-semibold">Controls</h3>
				<div className="flex items-center gap-2 text-sm">
					<Checkbox
						id={`${id}-dismissible`}
						checked={form.dismissible}
						onCheckedChange={(checked) =>
							onChange({ dismissible: checked === true })
						}
					/>
					<Label htmlFor={`${id}-dismissible`} className="font-normal">
						Let people dismiss it{" "}
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
				<div className="flex items-center gap-2 text-sm">
					<Checkbox
						id={`${id}-receipts`}
						checked={form.receipts !== false}
						onCheckedChange={(checked) =>
							onChange({ receipts: checked === true })
						}
					/>
					<Label htmlFor={`${id}-receipts`} className="font-normal">
						Record who viewed it, and let them confirm it{" "}
						<span className="text-content-secondary">
							(the Viewed box and Confirm; untick for a greeting)
						</span>
					</Label>
				</div>
				<div className="grid gap-6 border-0 border-t border-solid border-border pt-4 xl:grid-cols-2">
					<OpenField form={form} onChange={onChange} onTry={onTryOpen} />
					<CloseField form={form} onChange={onChange} onTry={onTryClose} />
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
			</fieldset>

			{problem && (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{problem}
				</p>
			)}

			<div className="sticky bottom-10 z-10 -mx-4 -mb-4 flex flex-wrap items-center gap-3 rounded-b-xl border-0 border-t border-solid border-border bg-surface-primary p-4 sm:-mx-6 sm:-mb-6 sm:px-6">
				<Button
					disabled={isPublishing || !dirty || !hasContent(form)}
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
					{dirty ? "You have unpublished changes." : ""}
				</span>
			</div>
		</section>
	);
};

type FieldProps = {
	form: BannerFields;
	onChange: (change: Partial<BannerFields>) => void;
};

/** The banner's font (and its scroll-down view's): bundled fonts and generic stacks only. */
const FontPicker: React.FC<FieldProps> = ({ form, onChange }) => {
	const font = form.font ?? "default";
	return (
		<Select
			value={font}
			onValueChange={(value) => {
				const next = BANNER_FONTS.find((f) => f === value);
				if (next) {
					onChange({ font: next as BannerFont });
				}
			}}
		>
			<SelectTrigger
				className="h-8 w-44 text-xs"
				aria-label="Font"
				title="The banner's font (only fonts that need no download)"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{BANNER_FONTS.map((f) => (
					<SelectItem key={f} value={f}>
						<span style={{ fontFamily: BANNER_FONT_OPTIONS[f].stack }}>
							{BANNER_FONT_OPTIONS[f].label}
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
};

/**
 * Outline: the text ringed in the opposite colour, for legibility over a busy
 * or changing background (any font, any effect: they are drawn as they are).
 */
const OutlineButton: React.FC<{
	on: boolean;
	onChange: (outline: boolean) => void;
}> = ({ on, onChange }) => (
	<Button
		size="icon"
		variant={on ? "default" : "outline"}
		className="size-8"
		aria-pressed={on}
		aria-label="Outline the text"
		title={
			on
				? "The text is outlined, to stay legible over any background (click to take the outline off)"
				: "Outline the text, to stay legible over a light or dark background (the font and effect stay as they are)"
		}
		onClick={() => onChange(!on)}
	>
		<TypeOutlineIcon />
	</Button>
);

// The banner's least opacity (the banner service's floor): it never fades away entirely.
const MIN_OPACITY = 20;

// The crawl's pace before it had a slider of its own (announcements with only a speed).
const LEGACY_CRAWL_SPEED: Record<BannerSpeed, number> = {
	slow: 9,
	normal: 15,
	fast: 26,
};

type CrawlSliderProps = {
	label: string;
	value: number;
	min: number;
	max: number;
	unit: string;
	hint: string;
	onChange: (value: number) => void;
};

/** One of the crawl's sliders: its name, the slider and the value it stands at. */
const CrawlSlider: React.FC<CrawlSliderProps> = ({
	label,
	value,
	min,
	max,
	unit,
	hint,
	onChange,
}) => (
	<span className="flex items-center gap-2" title={hint}>
		<span className="text-xs text-content-secondary">{label}</span>
		<Slider
			className="w-24"
			min={min}
			max={max}
			step={1}
			value={[value]}
			aria-label={label}
			onValueChange={([next]) => {
				if (next !== undefined) {
					onChange(next);
				}
			}}
		/>
		<span className="w-12 text-xs tabular-nums text-content-secondary">
			{value}
			{unit}
		</span>
	</span>
);

/** The crawl's pace and how far its lines converge towards the horizon. */
const CrawlControls: React.FC<FieldProps> = ({ form, onChange }) => (
	<span
		role="group"
		aria-label="Crawl"
		className="flex flex-wrap items-center gap-3"
	>
		<CrawlSlider
			label="Speed"
			value={form.crawlSpeed ?? LEGACY_CRAWL_SPEED[form.speed ?? "normal"]}
			min={CRAWL_SPEED.min}
			max={CRAWL_SPEED.max}
			unit=" px/s"
			hint="How fast the message rises, in pixels a second."
			onChange={(crawlSpeed) => onChange({ crawlSpeed })}
		/>
		<CrawlSlider
			label="Convergence"
			value={form.crawlTilt ?? CRAWL_TILT.default}
			min={CRAWL_TILT.min}
			max={CRAWL_TILT.max}
			unit="%"
			hint="How far the lines tilt away and narrow towards a horizon: 0% scrolls the message flat from the bottom up, 100% is the opening crawl."
			onChange={(crawlTilt) => onChange({ crawlTilt })}
		/>
	</span>
);

/** The text effect; the crawl's pace and convergence, the Knight Rider sweep's speed; whether it repeats. It plays on the draft preview. */
const EffectPicker: React.FC<FieldProps> = ({ form, onChange }) => (
	<div className="flex items-center gap-1">
		<Select
			value={form.effect}
			onValueChange={(value) => {
				const effect = BANNER_EFFECTS.find((e) => e === value);
				if (effect) {
					onChange({ effect });
				}
			}}
		>
			<SelectTrigger
				className="h-8 w-40 text-xs"
				aria-label="Text effect"
				title={EFFECT_OPTIONS[form.effect].hint}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{BANNER_EFFECTS.map((effect) => (
					<SelectItem
						key={effect}
						value={effect}
						title={EFFECT_OPTIONS[effect].hint}
					>
						{EFFECT_OPTIONS[effect].label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
		{form.effect === "starwars" && (
			<CrawlControls form={form} onChange={onChange} />
		)}
		{form.effect === "kitt" && (
			<Select
				value={form.speed ?? "normal"}
				onValueChange={(value) => {
					const speed = BANNER_SPEEDS.find((s) => s === value);
					if (speed) {
						onChange({ speed });
					}
				}}
			>
				<SelectTrigger className="h-8 w-24 text-xs" aria-label="Sweep speed">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{BANNER_SPEEDS.map((speed) => (
						<SelectItem key={speed} value={speed}>
							{SPEED_LABELS[speed]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		)}
		<Button
			size="icon"
			variant={form.repeat ? "default" : "outline"}
			className="size-8"
			disabled={form.effect === "none"}
			aria-pressed={form.repeat}
			aria-label="Repeat the effect continuously"
			title={
				form.repeat
					? "Repeats continuously (click to play it once)"
					: "Plays once when the banner appears (click to repeat it continuously)"
			}
			onClick={() => onChange({ repeat: !form.repeat })}
		>
			<Repeat2Icon />
		</Button>
	</div>
);

type ColorButtonProps = {
	label: string;
	/** What the button says beside its swatch. */
	short: string;
	value: string;
	presets: readonly ColorPreset[];
	onChange: (value: string) => void;
};

/** One colour: a swatch button (like the former Custom one) opening its presets, picker and hex value. */
const ColorButton: React.FC<ColorButtonProps> = ({
	label,
	short,
	value,
	presets,
	onChange,
}) => (
	<Popover>
		<PopoverTrigger asChild>
			<Button
				size="sm"
				variant="outline"
				aria-label={`${label}: ${value}`}
				title={`${label} (${value})`}
			>
				<span
					aria-hidden
					className="size-3 rounded-full shadow-[0_0_0_1px_hsl(var(--border-default))]"
					style={{ background: value }}
				/>
				{short}
			</Button>
		</PopoverTrigger>
		<PopoverContent align="start" className="w-80 p-4">
			<ColorField
				label={label}
				value={value}
				presets={presets}
				onChange={onChange}
			/>
		</PopoverContent>
	</Popover>
);

const AlignButton: React.FC<{
	value: BannerAlign;
	onChange: (align: BannerAlign) => void;
}> = ({ value, onChange }) => {
	const Icon = ALIGN_OPTIONS[value].icon;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					size="sm"
					variant="outline"
					className="min-w-0 gap-1 px-2"
					aria-label={`Alignment: ${ALIGN_OPTIONS[value].label}`}
					title="How the text lines up on the banner"
				>
					<Icon />
					<ChevronDownIcon className="size-3.5!" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(next) => {
						const align = BANNER_ALIGNS.find((a) => a === next);
						if (align) {
							onChange(align);
						}
					}}
				>
					{BANNER_ALIGNS.map((align) => {
						const { label, icon: ItemIcon } = ALIGN_OPTIONS[align];
						return (
							<DropdownMenuRadioItem key={align} value={align}>
								<ItemIcon />
								{label}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/**
 * The countdown: ticked, it is shown as a split-flap clock at the banner's far left,
 * before the text; only the moment it counts down to is asked for.
 */
const CountdownField: React.FC<{
	value: string;
	onChange: (countdown: string) => void;
}> = ({ value, onChange }) => {
	const id = useId();
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return (
		<div className="flex min-h-8 flex-wrap items-center gap-3">
			<div className="flex items-center gap-2 text-sm">
				<Checkbox
					id={`${id}-countdown`}
					checked={Boolean(value)}
					onCheckedChange={(checked) =>
						onChange(checked === true ? nextHour() : "")
					}
				/>
				<Label
					htmlFor={`${id}-countdown`}
					className="flex items-center gap-1.5 font-normal"
				>
					<TimerIcon aria-hidden className="size-4" />
					Countdown timer
				</Label>
			</div>
			{value && (
				<>
					<Input
						type="datetime-local"
						step={60}
						className="h-8 w-56 text-xs"
						aria-label={`Counts down to (${zone})`}
						value={toLocalInput(value)}
						onChange={(event) => {
							const next = utcSeconds(event.target.value);
							if (next) {
								onChange(next);
							}
						}}
					/>
					<span className="text-xs text-content-secondary">
						{zone}; shown as a split-flap clock at the banner's far left
					</span>
				</>
			)}
		</div>
	);
};

/**
 * Platform: how the banner comes in when it appears (the page loads with it,
 * or a new announcement arrives), and "Try it", which plays it on the preview
 * above.
 */
const OpenField: React.FC<FieldProps & { onTry: () => void }> = ({
	form,
	onChange,
	onTry,
}) => {
	const id = useId();
	const effect = form.openEffect ?? "none";
	return (
		<div className="flex flex-col gap-2 pt-1">
			<div className="flex flex-wrap items-center gap-3">
				<Label htmlFor={`${id}-open`} className="text-sm">
					Open transition
				</Label>
				<Select
					value={effect}
					onValueChange={(value) => {
						const next = BANNER_OPEN_EFFECTS.find((e) => e === value);
						if (next) {
							onChange({ openEffect: next as BannerOpenEffect });
						}
					}}
				>
					<SelectTrigger
						id={`${id}-open`}
						className="h-8 w-44 text-xs"
						aria-label="Open transition"
						aria-describedby={`${id}-hint`}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{BANNER_OPEN_EFFECTS.map((e) => (
							<SelectItem key={e} value={e}>
								{OPEN_EFFECT_OPTIONS[e].label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					size="sm"
					variant="outline"
					disabled={effect === "none" || !hasContent(form)}
					onClick={onTry}
				>
					<PlayIcon />
					Try it
				</Button>
			</div>
			<p id={`${id}-hint`} className="m-0 text-sm text-content-secondary">
				{OPEN_EFFECT_OPTIONS[effect].hint}
			</p>
		</div>
	);
};

/**
 * Platform: how the banner goes away when someone dismisses it, and "Try
 * it", which plays it on the draft preview (that then comes back).
 */
const CloseField: React.FC<FieldProps & { onTry: () => void }> = ({
	form,
	onChange,
	onTry,
}) => {
	const id = useId();
	const effect = form.closeEffect ?? "fade";
	return (
		<div className="flex flex-col gap-2 pt-1">
			<div className="flex flex-wrap items-center gap-3">
				<Label htmlFor={`${id}-close`} className="text-sm">
					Close transition
				</Label>
				<Select
					value={effect}
					disabled={!form.dismissible}
					onValueChange={(value) => {
						const next = BANNER_CLOSE_EFFECTS.find((e) => e === value);
						if (next) {
							onChange({ closeEffect: next as BannerCloseEffect });
						}
					}}
				>
					<SelectTrigger
						id={`${id}-close`}
						className="h-8 w-44 text-xs"
						aria-label="Close transition"
						aria-describedby={`${id}-hint`}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{BANNER_CLOSE_EFFECTS.map((e) => (
							<SelectItem key={e} value={e}>
								{CLOSE_EFFECT_OPTIONS[e].label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					size="sm"
					variant="outline"
					disabled={!form.dismissible || effect === "none" || !hasContent(form)}
					onClick={onTry}
				>
					<PlayIcon />
					Try it
				</Button>
			</div>
			<p id={`${id}-hint`} className="m-0 text-sm text-content-secondary">
				{form.dismissible
					? CLOSE_EFFECT_OPTIONS[effect].hint
					: "Only for an announcement people may dismiss."}
			</p>
		</div>
	);
};
