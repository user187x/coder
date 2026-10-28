import { MinusIcon, PlusIcon, RotateCcwIcon, ShuffleIcon } from "lucide-react";
import { Button } from "#/components/Button/Button";
import { Slider, Toggle } from "../background/HtmlBackgroundControls";
import { ColorField } from "../ColorField";
import { LAVA_LIMITS, type LavaSettings, randomBlob } from "./lava";

const COLOR_PRESETS = {
	primary: [
		{ name: "Lava", value: "#ffbf48" },
		{ name: "Ice", value: "#7fe3ff" },
		{ name: "Lime", value: "#c6ff4f" },
		{ name: "Orchid", value: "#ff8cf0" },
	],
	accent: [
		{ name: "Lava", value: "#be4a1d" },
		{ name: "Deep sea", value: "#1d4fbe" },
		{ name: "Moss", value: "#2f8a1d" },
		{ name: "Plum", value: "#7a1dbe" },
	],
} as const;

/**
 * The lava lamp's dials (lava.html's controls and more): speed, the two
 * colours, the bright look of its dark theme, the colour cycle, the lumps
 * (more, fewer, shuffled), the orb's size, and what is around it.
 */
export const LavaControls: React.FC<{
	value: LavaSettings;
	onChange: (value: LavaSettings) => void;
	/** The settings "Reset" goes back to. */
	defaults: LavaSettings;
	/** A picture (sized in it) rather than a background (sized in the window). */
	picture?: boolean;
	disabled?: boolean;
}> = ({ value, onChange, defaults, picture, disabled }) => {
	const set = (patch: Partial<LavaSettings>) =>
		onChange({ ...value, ...patch });
	const count = value.blobs.length;
	return (
		<fieldset
			className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
			disabled={disabled}
			data-testid="lava-controls"
		>
			<legend className="sr-only">Lava lamp</legend>
			<Slider
				label="Speed"
				value={value.spin}
				{...LAVA_LIMITS.spin}
				display={`${value.spin.toFixed(1)} s per turn`}
				onChange={(spin) => set({ spin })}
			/>
			<div className="grid gap-3 sm:grid-cols-2">
				<ColorField
					label="Primary"
					value={value.primary}
					presets={COLOR_PRESETS.primary}
					onChange={(primary) => set({ primary })}
				/>
				<ColorField
					label="Accent"
					value={value.accent}
					presets={COLOR_PRESETS.accent}
					onChange={(accent) => set({ accent })}
				/>
			</div>
			<div className="flex flex-wrap gap-x-5 gap-y-2">
				<Toggle
					label="Bright"
					hint="The stronger glow and lighter lava of the dark theme"
					checked={value.bright}
					onChange={(bright) => set({ bright })}
				/>
				<Toggle
					label="Colour cycle"
					hint="The colours slowly shift and come back"
					checked={value.cycle}
					onChange={(cycle) => set({ cycle })}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<span className="flex justify-between text-sm font-medium">
					Lava
					<span className="tabular-nums text-content-secondary">
						{count} {count === 1 ? "lump" : "lumps"}
					</span>
				</span>
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={count >= LAVA_LIMITS.blobs.max}
						onClick={() => set({ blobs: [...value.blobs, randomBlob()] })}
					>
						<PlusIcon />
						Add lava
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={count <= LAVA_LIMITS.blobs.min}
						onClick={() => set({ blobs: value.blobs.slice(0, -1) })}
					>
						<MinusIcon />
						Remove lava
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() =>
							set({ blobs: Array.from({ length: count }, () => randomBlob()) })
						}
					>
						<ShuffleIcon />
						Shuffle
					</Button>
				</div>
			</div>
			<Slider
				label="Orb size"
				value={value.size}
				{...LAVA_LIMITS.size}
				display={
					picture && value.size === 100
						? "100%: fills the picture"
						: `${value.size}%`
				}
				onChange={(size) => set({ size })}
			/>
			<span className="-mt-3 text-xs text-content-secondary">
				{picture
					? "Of the picture's width. At 100% the orb is exactly an avatar's circle."
					: "Of what the Fit goes by: the window's longer side (Fill), shorter side (Fit inside), width (Span), each side (Stretch), or the orb's own 256 px (Center, Tile)."}
			</span>
			<Toggle
				label="Backdrop"
				hint="Off: what is behind shows around the orb and through its glass"
				checked={!value.transparent}
				onChange={(backdrop) => set({ transparent: !backdrop })}
			/>
			<Toggle
				label="Vary each orb"
				hint={
					picture
						? "Every place it shows draws its own: its speed, colours and lava differ; off: all alike and in step"
						: "Tiled orbs each turn, cycle and lie differently; off: all in step"
				}
				checked={value.vary}
				onChange={(vary) => set({ vary })}
			/>
			{!value.transparent && (
				<ColorField
					label="Backdrop colour"
					value={value.backdrop}
					onChange={(backdrop) => set({ backdrop })}
				/>
			)}
			<div>
				<Button
					size="sm"
					variant="subtle"
					onClick={() => onChange({ ...defaults, blobs: [...defaults.blobs] })}
				>
					<RotateCcwIcon />
					Reset
				</Button>
			</div>
		</fieldset>
	);
};
