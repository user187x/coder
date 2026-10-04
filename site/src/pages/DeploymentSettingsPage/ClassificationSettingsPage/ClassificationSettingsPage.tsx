import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { ClassificationSettings } from "#/api/platform";
import { classification, updateClassification } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { Slider } from "#/components/Slider/Slider";
import { Spinner } from "#/components/Spinner/Spinner";
import { Switch } from "#/components/Switch/Switch";
import {
	classificationFontSize,
	classificationHeight,
} from "#/modules/platform/ClassificationBars";
import { ColorField, type ColorPreset } from "#/modules/platform/ColorField";
import { pageTitle } from "#/utils/page";

// Standard banner colours of US classification markings, as quick picks.
const BACKGROUNDS: ColorPreset[] = [
	{ name: "UNCLASSIFIED", value: "#007a33" },
	{ name: "CUI", value: "#502b85" },
	{ name: "CONFIDENTIAL", value: "#0033a0" },
	{ name: "SECRET", value: "#c8102e" },
	{ name: "TOP SECRET", value: "#ff8c00" },
	{ name: "TOP SECRET//SCI", value: "#fce83a" },
];
const FOREGROUNDS: ColorPreset[] = [
	{ name: "White", value: "#ffffff" },
	{ name: "Black", value: "#000000" },
];
// The light presets read best with black text.
const DARK_TEXT_BACKGROUNDS = new Set(["#fce83a", "#ff8c00"]);

const FIELDS = ["enabled", "text", "height", "background", "color"] as const;

const sameSettings = (a: ClassificationSettings, b: ClassificationSettings) =>
	FIELDS.every((field) => a[field] === b[field]);

// WCAG contrast ratio, to warn about unreadable combinations.
const luminance = (hex: string) => {
	const [r, g, b] = [1, 3, 5]
		.map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (a: string, b: string): number => {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
};

/**
 * General > Classification: the marking shown in a bar at the very top and
 * the very bottom of every Coder page, the sign-in page included.
 */
const ClassificationSettingsPage: React.FC = () => {
	const queryClient = useQueryClient();
	const settingsQuery = useQuery(classification());
	const save = useMutation(updateClassification(queryClient));
	// Edits are kept apart from the saved settings, which are re-read
	// periodically, so a refetch never discards them.
	const [draft, setDraft] = useState<ClassificationSettings | null>(null);

	return (
		<>
			<title>{pageTitle("Classification")}</title>
			<SettingsHeader>
				<SettingsHeaderTitle>Classification</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Mark every Coder page with its classification, in a bar at the very
					top and the very bottom.
				</SettingsHeaderDescription>
			</SettingsHeader>

			{settingsQuery.isLoading ? (
				<Loader />
			) : !settingsQuery.data ? (
				<ErrorAlert error={settingsQuery.error} />
			) : (
				<ClassificationForm
					saved={settingsQuery.data}
					form={draft ?? settingsQuery.data}
					onChange={(change) =>
						setDraft({ ...(draft ?? settingsQuery.data), ...change })
					}
					onDiscard={() => setDraft(null)}
					isSaving={save.isPending}
					onSave={(form) =>
						save.mutate(form, {
							onSuccess: (saved) => {
								setDraft(null);
								toast.success(
									saved.enabled
										? "Saved. Every Coder page shows the banners within 30 seconds."
										: "Saved. The banners are off.",
								);
							},
							onError: (error) => {
								toast.error(
									getErrorMessage(error, "The settings could not be saved."),
								);
							},
						})
					}
				/>
			)}
		</>
	);
};

type ClassificationFormProps = {
	saved: ClassificationSettings;
	form: ClassificationSettings;
	onChange: (change: Partial<ClassificationSettings>) => void;
	onDiscard: () => void;
	onSave: (form: ClassificationSettings) => void;
	isSaving: boolean;
};

export const ClassificationForm: React.FC<ClassificationFormProps> = ({
	saved,
	form,
	onChange,
	onDiscard,
	onSave,
	isSaving,
}) => {
	const dirty = !sameSettings(form, saved);
	const height = classificationHeight(form.height);
	const ratio = contrastRatio(form.background, form.color);
	const missingText = form.enabled && !form.text.trim();

	return (
		<div className="flex flex-col gap-6">
			<section
				aria-labelledby="classification-preview"
				className="rounded-lg border border-solid border-border p-6"
			>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h2
						id="classification-preview"
						className="m-0 text-base font-semibold"
					>
						Classification banners
					</h2>
					<div className="flex items-center gap-2.5">
						<Switch
							id="classification-enabled"
							checked={form.enabled}
							onCheckedChange={(enabled) => onChange({ enabled })}
						/>
						<Label htmlFor="classification-enabled">Show on every page</Label>
						<span className="text-sm text-content-secondary">
							{form.enabled ? "On" : "Off"}
						</span>
					</div>
				</div>
				<div
					aria-label="Preview"
					role="img"
					className="overflow-hidden rounded-md border border-solid border-border"
					style={{ opacity: form.enabled ? 1 : 0.45 }}
				>
					<PreviewBar settings={form} height={height} />
					<div className="flex h-24 items-center justify-center bg-surface-secondary text-sm text-content-secondary">
						Coder dashboard
					</div>
					<PreviewBar settings={form} height={height} />
				</div>
				<p className="m-0 mt-3 text-center text-sm text-content-secondary">
					Both bars always match: same text, height and colours, glued to the
					top and bottom of every Coder page (sign-in page included).
				</p>
			</section>

			<section
				aria-labelledby="classification-marking"
				className="flex flex-col gap-5 rounded-lg border border-solid border-border p-6"
			>
				<h2 id="classification-marking" className="m-0 text-base font-semibold">
					Marking
				</h2>
				<div className="flex flex-col gap-2">
					<Label htmlFor="classification-text">Classification text</Label>
					<Input
						id="classification-text"
						value={form.text}
						maxLength={120}
						placeholder="e.g. UNCLASSIFIED"
						autoComplete="off"
						spellCheck={false}
						onChange={(event) => onChange({ text: event.target.value })}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label id="classification-height-label">
						Banner height (top and bottom)
					</Label>
					<div className="flex items-center gap-3.5">
						<Slider
							aria-labelledby="classification-height-label"
							min={12}
							max={64}
							step={1}
							value={[height]}
							onValueChange={([value]) => onChange({ height: value })}
						/>
						<output className="min-w-14 text-right text-sm tabular-nums text-content-secondary">
							{height} px
						</output>
					</div>
				</div>
				<div className="grid gap-5 md:grid-cols-2">
					<ColorField
						label="Background colour"
						value={form.background}
						presets={BACKGROUNDS}
						onChange={(background) => onChange({ background })}
						onPreset={(background) =>
							onChange({
								background,
								color: DARK_TEXT_BACKGROUNDS.has(background)
									? "#000000"
									: "#ffffff",
							})
						}
					/>
					<ColorField
						label="Text colour"
						value={form.color}
						presets={FOREGROUNDS}
						onChange={(color) => onChange({ color })}
					/>
				</div>
				{ratio < 4.5 && (
					<p role="status" className="m-0 text-sm text-content-warning">
						Low contrast ({ratio.toFixed(1)}:1): the text may be hard to read.
						4.5:1 or more is recommended.
					</p>
				)}
				<div className="flex flex-wrap items-center gap-3">
					<Button
						disabled={!dirty || missingText || isSaving}
						onClick={() => onSave(form)}
					>
						<Spinner loading={isSaving} />
						Save
					</Button>
					<Button
						variant="outline"
						disabled={!dirty || isSaving}
						onClick={onDiscard}
					>
						Discard changes
					</Button>
					<span aria-live="polite" className="text-sm text-content-secondary">
						{missingText
							? "Enter the classification text to turn the banners on."
							: dirty
								? "Unsaved changes"
								: ""}
					</span>
				</div>
				<p className="m-0 text-sm text-content-secondary">
					{saved.updatedBy && saved.updatedAt
						? `Last changed by ${saved.updatedBy} on ${new Date(saved.updatedAt).toLocaleString("en-US")}.`
						: "Not set up yet."}
				</p>
			</section>
		</div>
	);
};

const PreviewBar: React.FC<{
	settings: ClassificationSettings;
	height: number;
}> = ({ settings, height }) => (
	<div
		className="flex items-center justify-center overflow-hidden whitespace-nowrap px-3 font-bold tracking-[.06em]"
		style={{
			height,
			lineHeight: `${height}px`,
			fontSize: classificationFontSize(height),
			background: settings.background,
			color: settings.color,
		}}
	>
		{settings.text || "CLASSIFICATION"}
	</div>
);

export default ClassificationSettingsPage;
