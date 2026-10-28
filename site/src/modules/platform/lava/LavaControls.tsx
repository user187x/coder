import { cn } from "cn";
import { MinusIcon, PlusIcon, RotateCcwIcon, ShuffleIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "#/components/Button/Button";
import { useAnimationsEnabled } from "../animations/animations";
import { Slider, Toggle } from "../background/HtmlBackgroundControls";
import { ColorField } from "../ColorField";
import { lavaRenderer } from "./drawLava";
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
 * The lava lamp drawn live, exactly as its picture will be (the same renderer):
 * still while the dashboard's motion effects are off.
 */
export const LavaPreview: React.FC<{
	settings: LavaSettings;
	/** Width and height in CSS pixels. */
	size: number;
	/** Shown in a circle, as an avatar is. */
	round?: boolean;
	className?: string;
}> = ({ settings, size, round, className }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const renderer = useRef<{
		px: number;
		draw: ReturnType<typeof lavaRenderer>;
	}>(null);
	const start = useRef(performance.now());
	const animated = useAnimationsEnabled();

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) {
			return;
		}
		const px = Math.round(size * window.devicePixelRatio);
		if (renderer.current?.px !== px) {
			canvas.width = px;
			canvas.height = px;
			try {
				renderer.current = { px, draw: lavaRenderer(px) };
			} catch {
				return;
			}
		}
		const { draw } = renderer.current;
		if (!animated) {
			draw(ctx, settings, 0);
			return;
		}
		let frame = 0;
		const tick = (now: number) => {
			draw(ctx, settings, (now - start.current) / 1000);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [settings, size, animated]);

	return (
		<canvas
			ref={canvasRef}
			aria-hidden
			style={{ width: size, height: size }}
			className={cn("block shrink-0", round && "rounded-full", className)}
		/>
	);
};

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
			{picture ? (
				<Toggle
					label="Glow and backdrop around the orb"
					hint="Off: only the orb, nothing around it"
					checked={!value.transparent}
					onChange={(around) =>
						set({
							transparent: !around,
							// The glow needs room: a picture-filling orb would leave none.
							...(around && value.size > 75 ? { size: 62 } : {}),
						})
					}
				/>
			) : (
				<Toggle
					label="Backdrop"
					hint="Off: the page shows around the orb and through its glass"
					checked={!value.transparent}
					onChange={(backdrop) => set({ transparent: !backdrop })}
				/>
			)}
			{(picture || !value.transparent) && (
				<ColorField
					label={value.transparent ? "Behind the glass" : "Backdrop"}
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
