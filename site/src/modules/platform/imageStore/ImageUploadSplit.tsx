import { ChevronDownIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	GalleryPicker,
	type GalleryPickerProps,
} from "../gallery/GalleryPicker";

/**
 * Platform: Upload with an arrow beside it (the Appearance backgrounds: the dashboard's and the sign-in page's).
 * Upload chooses a file of one's own; the arrow opens a centred dialog with every picture of the image store
 * (GalleryPicker) in a responsive, scrolling grid, picked with a click, the dialog then closing. The
 * pictures' animated previews load only while the dialog is open: nothing animates on the page meanwhile.
 */
export const ImageUploadSplit: React.FC<{
	/** Upload: opens the caller's file input. */
	onUpload: () => void;
	disabled?: boolean;
	/** A picture is being read or saved (Upload spins). */
	busy?: boolean;
	/** The dialog's title (what the picture is for). */
	title: string;
	/** The image store picker in the dialog (its own picks, as on the page before). */
	gallery: Omit<GalleryPickerProps, "layout" | "onChosen" | "label">;
	testId?: string;
}> = ({ onUpload, disabled, busy, title, gallery, testId }) => {
	const [open, setOpen] = useState(false);
	return (
		<div className="inline-flex" data-testid={testId}>
			<Button
				variant="outline"
				disabled={disabled}
				onClick={onUpload}
				className="rounded-r-none"
				data-testid={testId && `${testId}-upload`}
			>
				<Spinner loading={busy}>
					<UploadIcon aria-hidden />
				</Spinner>
				Upload
			</Button>
			<Button
				variant="outline"
				size="icon-lg"
				disabled={disabled}
				onClick={() => setOpen(true)}
				aria-label="Choose from the image store"
				title="Choose from the image store"
				aria-haspopup="dialog"
				aria-expanded={open}
				className="-ml-px rounded-l-none"
				data-testid={testId && `${testId}-store`}
			>
				<ChevronDownIcon aria-hidden />
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					className="w-[min(880px,94vw)] max-w-none"
					data-testid={testId && `${testId}-dialog`}
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>
							Every picture of the image store: the ones baked into the
							platform, the gallery's and those uploaded. Click one to use it.
						</DialogDescription>
					</DialogHeader>
					{open && (
						<GalleryPicker
							{...gallery}
							layout="grid"
							label=""
							onChosen={() => setOpen(false)}
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
};
