import { useId, useState } from "react";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { ColorField } from "../ColorField";
import { type FillSettings, fillSettings } from "./fill";

const SWATCHES = [
	{ name: "Slate", value: "#0f172a" },
	{ name: "Blue", value: "#2563eb" },
	{ name: "Violet", value: "#7c3aed" },
	{ name: "Green", value: "#15803d" },
	{ name: "Amber", value: "#f59e0b" },
	{ name: "White", value: "#ffffff" },
	{ name: "Black", value: "#000000" },
];

export const FillControls = ({
	value,
	onChange,
	disabled,
}: {
	value: FillSettings;
	onChange: (value: FillSettings) => void;
	disabled?: boolean;
}) => {
	const id = useId();
	const set = (patch: Partial<FillSettings>) =>
		onChange(fillSettings({ ...value, ...patch }));
	return (
		<fieldset
			disabled={disabled}
			className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
		>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`${id}-mode`}>Fill style</Label>
				<Select
					value={value.mode}
					disabled={disabled}
					onValueChange={(mode) => {
						if (mode === "solid" || mode === "linear" || mode === "radial")
							set({ mode });
					}}
				>
					<SelectTrigger id={`${id}-mode`}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="solid">Solid color</SelectItem>
						<SelectItem value="linear">Linear gradient</SelectItem>
						<SelectItem value="radial">Radial gradient</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<ColorField
				label={value.mode === "solid" ? "Fill color" : "Start color"}
				value={value.color}
				presets={SWATCHES}
				onChange={(color) => set({ color })}
			/>
			{value.mode !== "solid" && (
				<>
					<ColorField
						label="End color"
						value={value.endColor}
						presets={SWATCHES}
						onChange={(endColor) => set({ endColor })}
					/>
					<div className="grid grid-cols-2 gap-3">
						{value.mode === "linear" && (
							<div className="col-span-2 flex flex-col gap-2">
								<Label htmlFor={`${id}-angle`}>Angle (degrees)</Label>
								<FillNumberInput
									id={`${id}-angle`}
									type="number"
									min={0}
									max={360}
									value={value.angle}
									onChange={(angle) => set({ angle })}
								/>
							</div>
						)}
						<div className="flex flex-col gap-2">
							<Label htmlFor={`${id}-start`}>Start position (%)</Label>
							<FillNumberInput
								id={`${id}-start`}
								type="number"
								min={0}
								max={value.end - 1}
								value={value.start}
								onChange={(start) =>
									set({ start: Math.min(start, value.end - 1) })
								}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor={`${id}-end`}>End position (%)</Label>
							<FillNumberInput
								id={`${id}-end`}
								type="number"
								min={value.start + 1}
								max={100}
								value={value.end}
								onChange={(end) => set({ end })}
							/>
						</div>
					</div>
				</>
			)}
		</fieldset>
	);
};

const FillNumberInput = ({
	value,
	onChange,
	...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
	value: number;
	onChange: (value: number) => void;
}) => {
	const [draft, setDraft] = useState<string | null>(null);
	return (
		<Input
			{...props}
			value={draft ?? value}
			onChange={(event) => {
				setDraft(event.target.value);
				if (Number.isFinite(event.target.valueAsNumber))
					onChange(event.target.valueAsNumber);
			}}
			onBlur={() => setDraft(null)}
		/>
	);
};
