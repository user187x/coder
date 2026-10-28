import { useState } from "react";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Spinner } from "#/components/Spinner/Spinner";
import { type LavaPictureOptions, lavaPicture } from "./drawLava";
import { LavaControls, LavaPreview } from "./LavaControls";
import { LAVA_PICTURE_DEFAULT, type LavaSettings } from "./lava";

/** What most choosers take: a 256-pixel picture of at most 1 MB (the icon editor's limit). */
export const LAVA_PICTURE_OUTPUT: LavaPictureOptions = {
	size: 256,
	maxBytes: 1024 * 1024,
};

/**
 * Platform: the lava lamp in an image chooser, beside the image store: a live
 * preview with its dials, then "Use this" makes it an animated picture (one
 * whole loop) and gives it to the chooser as a file, as an upload would be.
 */
export const LavaDialog: React.FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreate: (file: File) => void;
	/** Previewed in a circle, as an avatar is shown. */
	round?: boolean;
	output?: LavaPictureOptions;
}> = ({
	open,
	onOpenChange,
	onCreate,
	round,
	output = LAVA_PICTURE_OUTPUT,
}) => {
	const [settings, setSettings] = useState<LavaSettings>(LAVA_PICTURE_DEFAULT);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string>();

	const create = () => {
		setBusy(true);
		setProblem(undefined);
		lavaPicture(settings, output)
			.then((file) => {
				onOpenChange(false);
				onCreate(file);
			})
			.catch((error: unknown) =>
				setProblem(
					error instanceof Error
						? error.message
						: "The lava lamp could not be made.",
				),
			)
			.finally(() => setBusy(false));
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) {
					onOpenChange(next);
				}
			}}
		>
			<DialogContent
				className="w-[min(760px,94vw)] max-w-none"
				data-testid="lava-dialog"
			>
				<DialogHeader>
					<DialogTitle>Lava lamp</DialogTitle>
					<DialogDescription>
						Set its speed, colours and lava. The preview is exactly the picture
						you get: one whole loop, animated.
					</DialogDescription>
				</DialogHeader>
				<div className="grid min-w-0 gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
					<div className="flex flex-col items-center gap-2">
						<div className="rounded-lg border border-solid border-border bg-surface-secondary p-3">
							<LavaPreview settings={settings} size={208} round={round} />
						</div>
						<span className="text-xs text-content-secondary">
							{round ? "As your avatar's circle shows it" : "Preview"}
						</span>
					</div>
					<div className="max-h-[min(60vh,520px)] min-w-0 overflow-y-auto pr-1">
						<LavaControls
							picture
							value={settings}
							defaults={LAVA_PICTURE_DEFAULT}
							disabled={busy}
							onChange={setSettings}
						/>
					</div>
				</div>
				{problem && (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						{problem}
					</p>
				)}
				<DialogFooter className="gap-2">
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button disabled={busy} onClick={create}>
						<Spinner loading={busy} />
						{busy ? "Making the picture…" : "Use this"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/** The lava lamp's place in a chooser: a live, small orb that opens LavaDialog. */
export const LavaEntry: React.FC<{
	onClick: () => void;
	disabled?: boolean;
}> = ({ onClick, disabled }) => (
	<button
		type="button"
		disabled={disabled}
		onClick={onClick}
		data-testid="lava-entry"
		className="flex w-full cursor-pointer items-center gap-3 rounded-md border border-solid border-border bg-surface-secondary p-2 text-left font-[inherit] text-content-primary transition-colors hover:border-content-link focus-visible:border-content-link focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
	>
		<LavaPreview settings={LAVA_PICTURE_DEFAULT} size={40} round />
		<span className="flex min-w-0 flex-col">
			<span className="text-sm font-semibold">Lava lamp</span>
			<span className="truncate text-xs text-content-secondary">
				Make one: speed, colours, lava, size
			</span>
		</span>
	</button>
);
