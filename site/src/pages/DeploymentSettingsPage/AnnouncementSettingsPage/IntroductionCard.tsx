import { CaptionsIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
	type BannerFields,
	INTRO_DURATION,
	INTRO_EFFECTS,
	INTRO_SIZES,
	INTRO_WEIGHTS,
	type IntroSize,
	type IntroWeight,
} from "#/api/platform";
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
import { SectionSplashPill } from "#/modules/platform/announcement/SectionSplashPill";
import { EffectGallery } from "./EffectGallery";

/** How long the slider rests before the duration is saved. */
const SAVE_DELAY_MS = 400;

const SIZE_LABELS: Record<IntroSize, string> = {
	normal: "Normal",
	large: "Large",
	xlarge: "Extra large",
};

const WEIGHT_LABELS: Record<IntroWeight, string> = {
	semibold: "Semibold",
	bold: "Bold",
	black: "Black",
};

type IntroductionSettings = Pick<
	BannerFields,
	| "introductions"
	| "introEffect"
	| "introDurationMs"
	| "introSize"
	| "introWeight"
	| "font"
	| "animationsDisabled"
>;

type IntroductionCardProps = {
	settings: IntroductionSettings;
	disabled?: boolean;
	/** Saves a change at once; the duration slider waits until it rests. */
	onChange: (change: Partial<IntroductionSettings>) => void;
};

/** Section introductions: the announcement banner names the admin settings section being opened. */
export const IntroductionCard: React.FC<IntroductionCardProps> = ({
	settings,
	disabled,
	onChange,
}) => {
	const id = useId();
	const saved = settings.introDurationMs ?? INTRO_DURATION.default;
	const [durationMs, setDurationMs] = useState(saved);
	useEffect(() => setDurationMs(saved), [saved]);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const effect = settings.introEffect ?? "none";
	const size = settings.introSize ?? "normal";
	const weight = settings.introWeight ?? "semibold";
	return (
		<section
			className="rounded-xl border border-solid border-border bg-surface-primary p-4 sm:p-6"
			aria-labelledby={`${id}-heading`}
		>
			<h2
				id={`${id}-heading`}
				className="m-0 flex items-center gap-2 text-base font-semibold"
			>
				<CaptionsIcon className="size-4" />
				Introduction
			</h2>
			<p className="text-sm text-content-secondary">
				When a developer opens another admin settings section, the announcement
				banner shows that section's name for the time set below. Nothing shows
				while no announcement banner is showing.
			</p>
			<div className="flex flex-col gap-4">
				<div className="flex items-center gap-3">
					<Switch
						id={`${id}-switch`}
						checked={settings.introductions === true}
						disabled={disabled}
						onCheckedChange={(introductions) => onChange({ introductions })}
					/>
					<Label htmlFor={`${id}-switch`}>Show section introductions</Label>
				</div>
				<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
					<EffectGallery
						label="Introduction text effect"
						value={effect}
						options={INTRO_EFFECTS}
						disabled={disabled}
						onChange={(introEffect) => onChange({ introEffect })}
					/>
					<Select
						value={size}
						disabled={disabled}
						onValueChange={(next) => {
							const introSize = INTRO_SIZES.find((s) => s === next);
							if (introSize) {
								onChange({ introSize });
							}
						}}
					>
						<SelectTrigger
							className="h-8 w-36 text-xs"
							aria-label="Introduction size"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{INTRO_SIZES.map((s) => (
								<SelectItem key={s} value={s}>
									{SIZE_LABELS[s]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select
						value={weight}
						disabled={disabled}
						onValueChange={(next) => {
							const introWeight = INTRO_WEIGHTS.find((w) => w === next);
							if (introWeight) {
								onChange({ introWeight });
							}
						}}
					>
						<SelectTrigger
							className="h-8 w-32 text-xs"
							aria-label="Introduction weight"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{INTRO_WEIGHTS.map((w) => (
								<SelectItem key={w} value={w}>
									{WEIGHT_LABELS[w]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center gap-3">
					<span id={`${id}-duration`} className="text-sm">
						Visible for
					</span>
					<Slider
						className="w-48"
						min={INTRO_DURATION.min / 1000}
						max={INTRO_DURATION.max / 1000}
						step={INTRO_DURATION.step / 1000}
						value={[durationMs / 1000]}
						disabled={disabled}
						aria-labelledby={`${id}-duration`}
						onValueChange={([seconds]) => {
							if (seconds === undefined) {
								return;
							}
							const next = Math.round(seconds * 1000);
							setDurationMs(next);
							clearTimeout(timer.current);
							timer.current = setTimeout(
								() => onChange({ introDurationMs: next }),
								SAVE_DELAY_MS,
							);
						}}
					/>
					<span className="w-10 text-sm tabular-nums text-content-secondary">
						{durationMs / 1000} s
					</span>
				</div>
				<div
					role="group"
					aria-label="Introduction preview"
					className="flex min-h-12 items-center justify-center rounded-md bg-surface-secondary p-2"
				>
					<SectionSplashPill
						key={`${effect}:${size}:${weight}`}
						label="Appearance"
						look={settings}
					/>
				</div>
			</div>
		</section>
	);
};
