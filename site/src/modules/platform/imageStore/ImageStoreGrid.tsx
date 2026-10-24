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
 * rows. Round tiles suit avatars. The dialog grid uses fixed-aspect previews with filenames.
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
				? "grid max-h-[min(66vh,448px)] auto-rows-max grid-cols-[repeat(auto-fill,minmax(min(100%,7rem),1fr))] content-start items-start gap-3 overflow-y-auto p-0.5 [scrollbar-gutter:stable]"
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
					"relative flex min-h-0 min-w-0 shrink-0 cursor-pointer items-center justify-center overflow-hidden border border-solid border-border p-0 transition-colors",
					"hover:border-content-link focus-visible:border-content-link focus-visible:outline-none disabled:cursor-wait",
					tile === "round"
						? "size-16 rounded-full bg-surface-secondary"
						: layout === "grid"
							? "aspect-[3/2] w-full rounded-lg bg-surface-secondary"
							: "h-16 w-24 rounded-md bg-surface-secondary",
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
						"pointer-events-none absolute inset-0 block size-full",
						tile === "round" ? "rounded-full object-cover" : "object-cover",
					)}
				/>
				{layout === "grid" && tile !== "round" && (
					<span className="pointer-events-none absolute inset-x-0 bottom-0 truncate border-0 border-t border-solid border-border bg-surface-primary/90 px-2 py-1 text-left text-xs text-content-primary">
						{image.name}
					</span>
				)}
			</button>
		))}
	</div>
);
