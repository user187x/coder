import { ImagesIcon } from "lucide-react";
import { useState } from "react";
import type { StoreImage } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import type { PrebakedPicture } from "../pictures";
import { ImageStoreGrid } from "./ImageStoreGrid";
import { useImageStore } from "./imageStore";

/**
 * Platform: a button that opens the image store (every picture: baked in, the gallery's, uploaded) to choose one
 * from - beside an Upload button where a chooser has no room for the whole grid (template icons).
 */
export const ImageStoreMenu: React.FC<{
	onChoose: (image: StoreImage) => void;
	extra?: readonly PrebakedPicture[];
	disabled?: boolean;
	label?: string;
	trigger?: React.ReactElement;
}> = ({ onChoose, extra, disabled, label = "Image store", trigger }) => {
	const [open, setOpen] = useState(false);
	const { images, isLoading } = useImageStore(extra);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				{trigger ?? (
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={disabled}
						data-testid="image-store-menu"
					>
						<ImagesIcon />
						{label}
					</Button>
				)}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[min(452px,calc(100vw-32px))] p-3"
			>
				<div className="mb-2 text-sm font-semibold">{label}</div>
				{isLoading && images.length === 0 ? (
					<p className="m-0 text-sm text-content-secondary">Loading…</p>
				) : (
					<ImageStoreGrid
						images={images}
						label={label}
						onChoose={(image) => {
							setOpen(false);
							onChoose(image);
						}}
					/>
				)}
			</PopoverContent>
		</Popover>
	);
};
