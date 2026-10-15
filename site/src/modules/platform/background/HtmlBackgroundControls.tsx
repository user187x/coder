import { cn } from "cn";
import { CodeIcon, FileUpIcon, RotateCcwIcon, ShuffleIcon } from "lucide-react";
import { useRef } from "react";
import type { BackgroundDials } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import { ColorField } from "../ColorField";
import { formatBytes } from "../images";
import { DIALS, dial, dialFilter, previewDocument } from "./backgroundHtml";
import {
	BACKGROUND_STYLES,
	type BackgroundStyle,
	PARTICLE_MOTIONS,
	PARTICLE_SHAPES,
	PARTICLE_THEMES,
	PARTICLES_DEFAULT,
	PARTICLES_LIMITS,
	type ParticleMotion,
	type ParticleShape,
	type ParticlesSettings,
	particlesHTML,
	particleThemeOf,
} from "./particles";

export type HtmlSource = "particles" | "custom";

const HTML_PLACEHOLDER = [
	"<!DOCTYPE html>",
	"<html>",
	"<head><style> body { margin: 0; background: … } </style></head>",
	"<body> … </body>",
	"</html>",
].join("\n");

/** A live, sandboxed frame of an HTML background (not saved yet): no network, its own origin. */
export const HtmlPreviewFrame: React.FC<{
	html: string;
	dials?: BackgroundDials;
	className?: string;
	style?: React.CSSProperties;
}> = ({ html, dials, className, style }) => (
	<iframe
		aria-hidden
		tabIndex={-1}
		title="Background preview"
		sandbox="allow-scripts"
		// The speed dial comes in through the fragment, as on the real page.
		srcDoc={previewDocument(html).replace(
			"location.hash.slice(1)",
			`"speed=${dial(dials, "speed")}"`,
		)}
		className={cn("pointer-events-none border-0", className)}
		style={{ filter: dialFilter(dials), ...style }}
	/>
);

/** The animated backgrounds to choose from, next to the pictures. */
export const HtmlSourcePicker: React.FC<{
	selected: HtmlSource | undefined;
	disabled?: boolean;
	onSelect: (source: HtmlSource) => void;
}> = ({ selected, disabled, onSelect }) => (
	<div className="flex flex-col gap-2" data-testid="html-source-picker">
		<span className="text-sm text-content-secondary">
			Or an animated one, with dials:
		</span>
		<div
			role="radiogroup"
			aria-label="Animated backgrounds"
			className="flex flex-wrap gap-2.5"
		>
			<button
				type="button"
				role="radio"
				aria-checked={selected === "particles"}
				aria-label="Particles (animated)"
				title="Particles: themes (Minecraft among them) and dials for their colours, shapes and motion"
				disabled={disabled}
				onClick={() => onSelect("particles")}
				className={cn(
					"relative h-16 w-24 cursor-pointer overflow-hidden rounded-md border border-solid border-border p-0",
					"hover:border-content-link focus-visible:border-content-link focus-visible:outline-none",
					selected === "particles" &&
						"border-content-link ring-2 ring-content-link",
				)}
			>
				<HtmlPreviewFrame
					html={particlesHTML(PARTICLES_DEFAULT)}
					className="absolute inset-0 h-[400%] w-[400%] origin-top-left scale-25"
				/>
				<span className="absolute right-0 bottom-0 left-0 bg-black/45 px-1 py-0.5 text-[10px] font-semibold text-white">
					Particles
				</span>
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={selected === "custom"}
				aria-label="Your own HTML and CSS"
				title="Paste or import your own HTML and CSS"
				disabled={disabled}
				onClick={() => onSelect("custom")}
				className={cn(
					"flex h-16 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-surface-secondary p-1 text-[11px] text-content-secondary",
					"hover:border-content-link hover:text-content-primary focus-visible:border-content-link focus-visible:outline-none",
					selected === "custom" &&
						"border-solid border-content-link text-content-primary ring-2 ring-content-link",
				)}
			>
				<CodeIcon className="size-4" />
				Your own HTML
			</button>
		</div>
	</div>
);

const Slider: React.FC<{
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	display: string;
	disabled?: boolean;
	onChange: (value: number) => void;
}> = ({ label, value, min, max, step, display, disabled, onChange }) => (
	<label className="flex flex-col gap-1 text-sm">
		<span className="flex justify-between font-medium">
			{label}
			<span className="tabular-nums text-content-secondary">{display}</span>
		</span>
		<input
			type="range"
			min={min}
			max={max}
			step={step}
			value={value}
			disabled={disabled}
			aria-label={label}
			onChange={(event) => onChange(Number(event.target.value))}
		/>
	</label>
);

const SHAPE_LABELS: Record<ParticleShape, string> = {
	orb: "Soft orbs",
	dot: "Dots",
	bubble: "Bubbles",
	square: "Squares",
	block: "Pixel blocks",
	diamond: "Diamonds",
	spark: "Sparks",
};

const MOTION_LABELS: Record<ParticleMotion, string> = {
	orbit: "Orbit",
	drift: "Drift",
	rise: "Rise",
	fall: "Fall",
	twinkle: "Twinkle",
};

const BACKGROUND_STYLE_LABELS: Record<BackgroundStyle, string> = {
	solid: "Solid",
	vertical: "Vertical gradient",
	radial: "Radial glow",
};

/** One of a few choices, as a row of buttons. */
function Choice<T extends string>({
	label,
	options,
	labels,
	value,
	onChange,
	children,
}: {
	label: string;
	options: readonly T[];
	labels: Record<T, string>;
	value: T;
	onChange: (value: T) => void;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-sm font-medium">{label}</span>
			<div className="flex flex-wrap items-center gap-1.5">
				<div
					role="radiogroup"
					aria-label={label}
					className="flex flex-wrap gap-1.5"
				>
					{options.map((option) => (
						<Button
							key={option}
							size="sm"
							role="radio"
							aria-checked={option === value}
							variant={option === value ? "default" : "outline"}
							className="min-w-0"
							onClick={() => onChange(option)}
						>
							{labels[option]}
						</Button>
					))}
				</div>
				{children}
			</div>
		</div>
	);
}

const Toggle: React.FC<{
	label: string;
	hint: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}> = ({ label, hint, checked, onChange }) => (
	<label className="flex items-center gap-2 text-sm" title={hint}>
		<input
			type="checkbox"
			checked={checked}
			onChange={(event) => onChange(event.target.checked)}
			className="size-4 accent-[hsl(var(--content-link))]"
		/>
		{label}
	</label>
);

/** The Particles themes: ready-made settings, each drawn live in its tile. */
const ThemePicker: React.FC<{
	value: ParticlesSettings;
	onPick: (settings: ParticlesSettings) => void;
}> = ({ value, onPick }) => {
	const current = particleThemeOf(value);
	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium">Themes</span>
			<div
				role="radiogroup"
				aria-label="Particle themes"
				className="flex flex-wrap gap-2.5"
				data-testid="particle-themes"
			>
				{PARTICLE_THEMES.map((t) => (
					<button
						key={t.id}
						type="button"
						role="radio"
						aria-checked={current?.id === t.id}
						aria-label={t.name}
						title={`${t.name}: ${t.description}`}
						data-theme={t.id}
						onClick={() => onPick(t.settings)}
						className={cn(
							"relative h-16 w-28 cursor-pointer overflow-hidden rounded-md border border-solid border-border p-0",
							"hover:border-content-link focus-visible:border-content-link focus-visible:outline-none",
							current?.id === t.id &&
								"border-content-link ring-2 ring-content-link",
						)}
					>
						<HtmlPreviewFrame
							html={particlesHTML(t.settings)}
							className="absolute inset-0 h-[400%] w-[400%] origin-top-left scale-25"
						/>
						<span className="absolute right-0 bottom-0 left-0 truncate bg-black/50 px-1 py-0.5 text-left text-[10px] font-semibold text-white">
							{t.name}
						</span>
					</button>
				))}
			</div>
			<p className="m-0 text-xs text-content-secondary" aria-live="polite">
				{current
					? current.description
					: "Your own settings. Pick a theme to start again from it."}
			</p>
		</div>
	);
};

/**
 * The Particles preset's own dials: a theme to start from; the background
 * (solid or a gradient); the particles' colours, shape and motion; how many,
 * how big and how varied, how opaque; their glow; luminous blending; and a
 * shuffle of their places.
 */
export const ParticlesControls: React.FC<{
	value: ParticlesSettings;
	disabled?: boolean;
	onChange: (value: ParticlesSettings) => void;
}> = ({ value, disabled, onChange }) => {
	const set = (change: Partial<ParticlesSettings>) =>
		onChange({ ...value, ...change });
	return (
		<fieldset
			className="m-0 flex flex-col gap-4 rounded-md border border-solid border-border p-3"
			disabled={disabled}
			data-testid="particles-controls"
		>
			<legend className="px-1 text-sm font-semibold">Particles</legend>
			<ThemePicker value={value} onPick={onChange} />
			<Choice
				label="Background"
				options={BACKGROUND_STYLES}
				labels={BACKGROUND_STYLE_LABELS}
				value={value.backgroundStyle}
				onChange={(backgroundStyle) => set({ backgroundStyle })}
			/>
			<div className="grid gap-3 sm:grid-cols-2">
				<ColorField
					label={
						value.backgroundStyle === "solid"
							? "Background"
							: value.backgroundStyle === "vertical"
								? "Top"
								: "Edges"
					}
					value={value.background}
					onChange={(background) => set({ background })}
				/>
				{value.backgroundStyle !== "solid" && (
					<ColorField
						label={value.backgroundStyle === "vertical" ? "Bottom" : "Middle"}
						value={value.background2}
						onChange={(background2) => set({ background2 })}
					/>
				)}
			</div>
			<div className="grid gap-3 sm:grid-cols-3">
				{value.colors.map((c, i) => (
					<ColorField
						key={i}
						label={`Colour ${i + 1}`}
						value={c}
						onChange={(next) => {
							const colors = [...value.colors] as ParticlesSettings["colors"];
							colors[i] = next;
							set({ colors });
						}}
					/>
				))}
			</div>
			<Choice
				label="Shape"
				options={PARTICLE_SHAPES}
				labels={SHAPE_LABELS}
				value={value.shape}
				onChange={(shape) => set({ shape })}
			/>
			<Choice
				label="Motion"
				options={PARTICLE_MOTIONS}
				labels={MOTION_LABELS}
				value={value.motion}
				onChange={(motion) => set({ motion })}
			>
				{value.motion !== "orbit" && (
					<span className="ml-2">
						<Toggle
							label="Tumble"
							hint="Each particle turns about itself as it goes"
							checked={value.tumble}
							onChange={(tumble) => set({ tumble })}
						/>
					</span>
				)}
			</Choice>
			<div className="grid gap-3 sm:grid-cols-2">
				<Slider
					label="Particles"
					{...PARTICLES_LIMITS.count}
					value={value.count}
					display={String(value.count)}
					onChange={(count) => set({ count })}
				/>
				<Slider
					label="Size"
					{...PARTICLES_LIMITS.size}
					value={value.size}
					display={`${value.size} vmin`}
					onChange={(size) => set({ size })}
				/>
				<Slider
					label="Size variety"
					{...PARTICLES_LIMITS.variation}
					value={value.variation}
					display={`${Math.round(value.variation * 100)}%`}
					onChange={(variation) => set({ variation })}
				/>
				<Slider
					label="Opacity"
					{...PARTICLES_LIMITS.opacity}
					value={value.opacity}
					display={`${Math.round(value.opacity * 100)}%`}
					onChange={(opacity) => set({ opacity })}
				/>
				<Slider
					label="Glow distance"
					{...PARTICLES_LIMITS.spread}
					value={value.spread}
					display={`${value.spread} vmin`}
					onChange={(spread) => set({ spread })}
				/>
				<Slider
					label="Glow softness"
					{...PARTICLES_LIMITS.glow}
					value={value.glow}
					display={value.glow ? `${value.glow.toFixed(2)}×` : "none"}
					onChange={(glow) => set({ glow })}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<Toggle
					label="Luminous"
					hint="Overlapping particles brighten each other, as light does"
					checked={value.screen}
					onChange={(screen) => set({ screen })}
				/>
				<Button
					size="sm"
					variant="outline"
					title="Put the particles in other places"
					onClick={() =>
						set({
							seed:
								1 + ((value.seed + 1 + Math.floor(Math.random() * 997)) % 999),
						})
					}
				>
					<ShuffleIcon />
					Shuffle places
				</Button>
				<span className="text-xs tabular-nums text-content-secondary">
					{value.seed ? `Layout ${value.seed}` : "The original layout"}
				</span>
				<Button
					size="sm"
					variant="outline"
					onClick={() => onChange(PARTICLES_DEFAULT)}
				>
					<RotateCcwIcon />
					Back to the original
				</Button>
			</div>
		</fieldset>
	);
};

/** Paste or import an HTML / CSS page to use as the background. */
export const CustomHtmlEditor: React.FC<{
	html: string;
	maxBytes: number;
	loading?: boolean;
	disabled?: boolean;
	onChange: (html: string) => void;
	onProblem: (problem: string | undefined) => void;
}> = ({ html, maxBytes, loading, disabled, onChange, onProblem }) => {
	const inputRef = useRef<HTMLInputElement>(null);
	const bytes = new TextEncoder().encode(html).length;
	return (
		<fieldset
			className="m-0 flex flex-col gap-2 rounded-md border border-solid border-border p-3"
			disabled={disabled}
		>
			<legend className="px-1 text-sm font-semibold">Your own HTML</legend>
			<p className="m-0 text-xs text-content-secondary">
				A whole page (HTML with its CSS, and scripts if it needs them), drawn
				full-window. It runs sandboxed: it can't reach Coder, its cookies or the
				network, so pictures and fonts must be inline (data: URLs).
			</p>
			<textarea
				value={loading ? "Loading…" : html}
				readOnly={loading}
				onChange={(event) => {
					onProblem(undefined);
					onChange(event.target.value);
				}}
				spellCheck={false}
				rows={10}
				aria-label="Background HTML"
				placeholder={HTML_PLACEHOLDER}
				className="min-h-40 w-full resize-y rounded-md border border-solid border-border bg-surface-primary p-2 font-mono text-xs leading-snug text-content-primary"
			/>
			<div className="flex flex-wrap items-center gap-3">
				<Button
					size="sm"
					variant="outline"
					onClick={() => inputRef.current?.click()}
				>
					<FileUpIcon />
					Import an .html file…
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => onChange(particlesHTML(PARTICLES_DEFAULT))}
				>
					<CodeIcon />
					Start from the Particles example
				</Button>
				<span
					className={cn(
						"text-xs tabular-nums",
						bytes > maxBytes
							? "text-content-destructive"
							: "text-content-secondary",
					)}
				>
					{formatBytes(bytes)} of {formatBytes(maxBytes)}
				</span>
				<input
					ref={inputRef}
					type="file"
					accept=".html,.htm,text/html"
					aria-label="Import an HTML file"
					className="hidden"
					onChange={async (event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = "";
						if (!file) {
							return;
						}
						if (file.size > maxBytes) {
							onProblem(
								`${file.name} is larger than ${formatBytes(maxBytes)}.`,
							);
							return;
						}
						onProblem(undefined);
						onChange(await file.text());
					}}
				/>
			</div>
		</fieldset>
	);
};

/** The dials every HTML background has: speed, then colour filters. */
export const DialControls: React.FC<{
	value: BackgroundDials;
	disabled?: boolean;
	onChange: (value: BackgroundDials) => void;
}> = ({ value, disabled, onChange }) => (
	<fieldset
		className="m-0 flex flex-col gap-3 rounded-md border border-solid border-border p-3"
		disabled={disabled}
	>
		<legend className="px-1 text-sm font-semibold">Dials</legend>
		<div className="grid gap-3 sm:grid-cols-2">
			{(Object.keys(DIALS) as (keyof BackgroundDials)[]).map((key) => {
				const d = DIALS[key];
				const v = dial(value, key);
				return (
					<Slider
						key={key}
						label={d.label}
						min={d.min}
						max={d.max}
						step={d.step}
						value={v}
						display={`${d.unit === "×" ? v.toFixed(2) : v}${d.unit === "°" ? "°" : d.unit === "px" ? " px" : "×"}`}
						onChange={(next) => onChange({ ...value, [key]: next })}
					/>
				);
			})}
		</div>
		<div>
			<Button size="sm" variant="outline" onClick={() => onChange({})}>
				<RotateCcwIcon />
				Reset the dials
			</Button>
		</div>
	</fieldset>
);
