import { cn } from "cn";
import { SparklesIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { BANNER_EFFECTS, type BannerEffect } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { BannerText } from "#/modules/platform/announcement/BannerText";
import { EffectStage } from "#/modules/platform/announcement/EffectStage";
import { EFFECT_OPTIONS } from "./effectOptions";

type EffectGalleryProps = {
	value: BannerEffect;
	onChange: (effect: BannerEffect) => void;
	/** The effects offered; all of them by default. */
	options?: readonly BannerEffect[];
	label?: string;
	disabled?: boolean;
};

/** Short enough for the split-flap's plates to fit a tile. */
const SAMPLE = "Sample";

/**
 * The text effect chooser: a pop-out gallery of tiles, each showing the
 * effect on sample text. The tile under the pointer or focus plays its
 * effect; the others stay still, so the gallery costs little to draw. The
 * tiles are radios in one group: Tab enters it, the arrow keys move, Enter
 * or Space chooses (the image store grid's pattern).
 */
export const EffectGallery: React.FC<EffectGalleryProps> = ({
	value,
	onChange,
	options = BANNER_EFFECTS,
	label = "Text effect",
	disabled,
}) => {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState<BannerEffect | null>(null);
	const tiles = useRef(new Map<BannerEffect, HTMLButtonElement>());
	const id = useId();

	const move = (from: BannerEffect, step: number) => {
		const index = options.indexOf(from);
		const next = options[(index + step + options.length) % options.length];
		if (next) {
			tiles.current.get(next)?.focus();
		}
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				setActive(null);
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="h-8 w-40 justify-start text-xs"
					disabled={disabled}
					aria-label={label}
					title={EFFECT_OPTIONS[value].hint}
				>
					<SparklesIcon />
					<span className="truncate">{EFFECT_OPTIONS[value].label}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[min(480px,calc(100vw-32px))] p-3"
			>
				<div id={`${id}-title`} className="mb-2 text-sm font-semibold">
					{label}
				</div>
				<div
					role="radiogroup"
					aria-labelledby={`${id}-title`}
					className="grid max-h-[min(60vh,420px)] grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 overflow-y-auto p-0.5"
				>
					{options.map((effect) => {
						const selected = effect === value;
						return (
							<button
								key={effect}
								ref={(node) => {
									if (node) {
										tiles.current.set(effect, node);
									} else {
										tiles.current.delete(effect);
									}
								}}
								type="button"
								role="radio"
								aria-checked={selected}
								aria-label={EFFECT_OPTIONS[effect].label}
								title={EFFECT_OPTIONS[effect].hint}
								tabIndex={
									selected ||
									(effect === options[0] && !options.includes(value))
										? 0
										: -1
								}
								onPointerEnter={() => setActive(effect)}
								onPointerLeave={() => setActive(null)}
								// Opening the gallery focuses the selected tile; only keyboard focus plays a preview, so an idle gallery stays still.
								onFocus={(event) => {
									if (event.currentTarget.matches(":focus-visible")) {
										setActive(effect);
									}
								}}
								onBlur={() => setActive(null)}
								onKeyDown={(event) => {
									const step =
										event.key === "ArrowRight" || event.key === "ArrowDown"
											? 1
											: event.key === "ArrowLeft" || event.key === "ArrowUp"
												? -1
												: 0;
									if (step !== 0) {
										event.preventDefault();
										move(effect, step);
									}
								}}
								onClick={() => {
									onChange(effect);
									setOpen(false);
								}}
								className={cn(
									"flex cursor-pointer flex-col items-stretch gap-1 overflow-hidden rounded-lg border border-solid border-border bg-surface-secondary p-0 text-left transition-colors",
									"hover:border-content-link focus-visible:border-content-link focus-visible:outline-none",
									selected && "border-content-link ring-2 ring-content-link",
								)}
							>
								<span aria-hidden className="flex">
									{/* The banner's own screen and colours; remounted when it becomes the active tile, so the effect plays from its start. */}
									<EffectStage className="h-12 flex-1 rounded-none text-xs">
										<BannerText
											key={active === effect ? "playing" : "still"}
											animate={active === effect}
											still
											banner={{
												title: "",
												message: SAMPLE,
												linkText: "",
												linkUrl: "",
												effect,
												repeat: true,
												markdown: false,
												align: "center",
											}}
											className="block min-w-0 flex-1 truncate"
										/>
									</EffectStage>
								</span>
								<span className="truncate px-2 pb-1 text-xs">
									{EFFECT_OPTIONS[effect].label}
								</span>
							</button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
};
