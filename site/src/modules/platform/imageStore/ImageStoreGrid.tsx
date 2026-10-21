import { cn } from "cn";
import type { StoreImage } from "#/api/platform";

const SOURCE_LABEL: Record<StoreImage["source"], string> = {
	store: "baked in",
	dashboard: "baked in",
	gallery: "gallery",
	uploaded: "uploaded",
};

/**
 * Platform: the image store's pictures as tiles to choose from - their small animated previews where the store has
 * them (its pictures run to tens of MB), each loaded as it scrolls into view - in a box that scrolls past a few
 * rows. Dark tiles suit logos and backgrounds, round ones avatars. The "grid" layout (ImageUploadSplit's dialog):
 * five columns, four rows in view, larger tiles.
 */
export const ImageStoreGrid: React.FC<{
	images: readonly StoreImage[];
	selected?: string;
	onChoose: (image: StoreImage) => void;
	tile?: "dark" | "round";
	disabled?: boolean;
	/** The picture being fetched (its tile dims). */
	loading?: string;
	label?: string;
	className?: string;
	layout?: "wrap" | "grid";
}> = ({
	images,
	selected,
	onChoose,
	tile = "dark",
	disabled,
	loading,
	label = "Image store",
	className,
	layout = "wrap",
}) => (
	<div
		role="radiogroup"
		aria-label={label}
		data-testid="image-store-grid"
		data-layout={layout}
		className={cn(
			layout === "grid"
				? "grid max-h-[min(66vh,448px)] grid-cols-3 content-start gap-3 overflow-y-auto p-0.5 sm:grid-cols-5"
				: "flex max-h-[232px] flex-wrap content-start gap-2.5 overflow-y-auto p-0.5",
			className,
		)}
	>
		{images.map((image) => (
			<button
				key={image.url}
				type="button"
				role="radio"
				aria-checked={selected === image.name}
				aria-label={image.name}
				title={`${image.name} · ${SOURCE_LABEL[image.source]}`}
				data-source={image.source}
				data-testid="image-store-item"
				disabled={disabled || loading !== undefined}
				onClick={() => onChoose(image)}
				className={cn(
					"flex shrink-0 cursor-pointer items-center justify-center overflow-hidden border border-solid border-border p-0 transition-colors",
					"hover:border-content-link focus-visible:border-content-link focus-visible:outline-none disabled:cursor-wait",
					tile === "round"
						? "size-16 rounded-full bg-surface-secondary"
						: layout === "grid"
							? "aspect-[3/2] w-full rounded-md bg-[#09090b]"
							: "h-16 w-24 rounded-md bg-[#09090b]",
					selected === image.name &&
						"border-content-link ring-2 ring-content-link",
					loading === image.name && "opacity-60",
				)}
			>
				<img
					src={image.thumb ?? image.url}
					alt=""
					loading="lazy"
					className={cn(
						"size-full",
						tile === "round" ? "rounded-full object-cover" : "object-cover",
					)}
				/>
			</button>
		))}
	</div>
);
