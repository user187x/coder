import { cn } from "cn";
import { PipetteIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export type ColorPreset = { name: string; value: string };

type ColorFieldProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	presets?: readonly ColorPreset[];
	/** Called instead of `onChange` when a preset is chosen. */
	onPreset?: (value: string) => void;
	className?: string;
};

/**
 * A colour: optional preset swatches, the browser's colour picker, an
 * eyedropper where the browser has one, and the hex value.
 */
export const ColorField: React.FC<ColorFieldProps> = ({
	label,
	value,
	onChange,
	presets,
	onPreset,
	className,
}) => {
	const id = useId();
	// The hex field may hold a half-typed value; the colour only follows a
	// complete one.
	const [draft, setDraft] = useState<string | null>(null);
	const EyeDropper = window.EyeDropper;

	return (
		<fieldset className={cn("m-0 min-w-0 border-0 p-0", className)}>
			<legend className="mb-2 p-0 text-sm font-semibold">{label}</legend>
			{presets && presets.length > 0 && (
				<div
					role="group"
					aria-label={`${label} presets`}
					className="mb-2 flex flex-wrap gap-2"
				>
					{presets.map((preset) => (
						<button
							key={preset.value}
							type="button"
							aria-pressed={preset.value === value.toLowerCase()}
							aria-label={`${preset.name} ${preset.value}`}
							title={`${preset.name} (${preset.value})`}
							onClick={() => (onPreset ?? onChange)(preset.value)}
							className={cn(
								"size-[30px] cursor-pointer rounded-full border-2 border-solid p-0",
								preset.value === value.toLowerCase()
									? "border-content-primary shadow-[inset_0_0_0_2px_hsl(var(--surface-primary))]"
									: "border-border",
							)}
							style={{ background: preset.value }}
						/>
					))}
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2.5">
				<input
					type="color"
					aria-label={`${label} picker`}
					value={value}
					onChange={(event) => onChange(event.target.value.toLowerCase())}
					className="h-[34px] w-11 cursor-pointer rounded-md border border-solid border-border bg-transparent px-0.5"
				/>
				{EyeDropper && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-label={`Pick the ${label.toLowerCase()} from the screen`}
						title="Pick a colour from the screen"
						onClick={() => {
							new EyeDropper()
								.open()
								.then((result) =>
									onChange(result.sRGBHex.slice(0, 7).toLowerCase()),
								)
								.catch(() => {
									// Cancelled.
								});
						}}
					>
						<PipetteIcon />
					</Button>
				)}
				<Input
					id={id}
					aria-label={`${label} (hex)`}
					value={draft ?? value}
					maxLength={7}
					spellCheck={false}
					className="w-[100px] font-mono"
					onChange={(event) => {
						const next = event.target.value.trim();
						setDraft(next);
						if (HEX_RE.test(next)) {
							onChange(next.toLowerCase());
						}
					}}
					onBlur={() => setDraft(null)}
				/>
			</div>
		</fieldset>
	);
};
