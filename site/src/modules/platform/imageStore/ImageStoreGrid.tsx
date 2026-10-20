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
 * rows. Dark tiles suit logos and backgrounds, round ones avatars.
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
}> = ({
	images,
	selected,
	onChoose,
	tile = "dark",
	disabled,
	loading,
	label = "Image store",
	className,
}) => (
	<div
		role="radiogroup"
		aria-label={label}
		data-testid="image-store-grid"
		className={cn(
			"flex max-h-[232px] flex-wrap content-start gap-2.5 overflow-y-auto p-0.5",
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
