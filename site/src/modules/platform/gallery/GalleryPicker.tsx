import { useState } from "react";
import { ImageStoreGrid } from "../imageStore/ImageStoreGrid";
import {
	fetchStoreImage,
	isBaked,
	referenceOf,
	useImageStore,
} from "../imageStore/imageStore";
import type { PrebakedPicture } from "../pictures";

export type GalleryPickerProps = {
	/** Called with the picture as a file, exactly as if it had been chosen. */
	onPick: (file: File) => void;
	/** Clears the highlighted picture when the user picks a file of their own. */
	selected?: string;
	onSelect?: (name: string | undefined) => void;
	/** Dark tiles suit logos (most are drawn for the dark navigation bar). */
	tile?: "dark" | "round";
	disabled?: boolean;
	label?: string;
	/** Platform: pictures baked into the dashboard, offered first (the backgrounds' prebaked ones). */
	extra?: readonly PrebakedPicture[];
	/** Platform: the tiles' layout (ImageStoreGrid): "grid" in ImageUploadSplit's dialog. */
	layout?: "wrap" | "grid";
	/** Platform: called once a picture has been chosen (the dialog closes). */
	onChosen?: () => void;
	/**
	 * A baked-in picture chosen (the image store's own, or one baked into the dashboard): given as its address, for a
	 * caller that stores a reference rather than the file. Without it, it comes as a file like the others.
	 */
	onPickBuiltin?: (picture: PrebakedPicture) => void;
};

/**
 * The image store next to "choose your own" (the logo, avatar and background editors): every picture there is -
 * the chooser's own presets (extra), the pictures baked into the platform service's image and into the dashboard
 * (there with every install), the gallery's and the ones uploaded for the announcement - as tiles to choose from.
 */
export const GalleryPicker: React.FC<GalleryPickerProps> = ({
	onPick,
	selected,
	onSelect,
	tile = "dark",
	disabled,
	label = "Or use one from the image store:",
	extra = [],
	onPickBuiltin,
	layout,
	onChosen,
}) => {
	const { images } = useImageStore(extra);
	const [loading, setLoading] = useState<string>();
	if (images.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-2" data-testid="gallery-picker">
			{label && <span className="text-sm text-content-secondary">{label}</span>}
			<ImageStoreGrid
				layout={layout}
				images={images}
				selected={selected}
				tile={tile}
				disabled={disabled}
				loading={loading}
				onChoose={async (image) => {
					if (isBaked(image) && onPickBuiltin) {
						onSelect?.(image.name);
						onPickBuiltin({
							name: image.name,
							url: referenceOf(image),
							type: image.type,
						});
						onChosen?.();
						return;
					}
					setLoading(image.name);
					try {
						const file = await fetchStoreImage(image);
						onSelect?.(image.name);
						onPick(file);
						onChosen?.();
					} finally {
						setLoading(undefined);
					}
				}}
			/>
		</div>
	);
};
