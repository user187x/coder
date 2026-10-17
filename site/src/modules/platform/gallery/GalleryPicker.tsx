import { cn } from "cn";
import { useState } from "react";
import { useQuery } from "react-query";
import { type GalleryImage, PlatformAPI } from "#/api/platform";
import { PREBAKED_GALLERY, type PrebakedPicture } from "../pictures";

type GalleryPickerProps = {
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
	/**
	 * A picture baked into the dashboard (extra, and the gallery's own: PREBAKED_GALLERY) chosen: given as it is,
	 * for a caller that stores its path rather than the file. Without it, it comes as a file like the others.
	 */
	onPickBuiltin?: (picture: PrebakedPicture) => void;
};

/**
 * The pictures to choose from next to "choose your own" (the logo, avatar and
 * background editors): those baked into the dashboard (extra, then
 * PREBAKED_GALLERY: there with every install), then any the platform service
 * has (helm-chart/defaults/gallery/, which install.sh installs).
 */
export const GalleryPicker: React.FC<GalleryPickerProps> = ({
	onPick,
	selected,
	onSelect,
	tile = "dark",
	disabled,
	label = "Or use one of the provided pictures:",
	extra = [],
	onPickBuiltin,
}) => {
	const query = useQuery({
		queryKey: ["platform", "gallery"],
		queryFn: PlatformAPI.getGallery,
		staleTime: 60_000,
	});
	const [loading, setLoading] = useState<string>();
	const builtins = [
		...extra,
		...PREBAKED_GALLERY.filter((p) => !extra.some((e) => e.name === p.name)),
	];
	const images: GalleryImage[] = [
		...builtins.map((p) => ({ ...p, bytes: 0 })),
		...(query.data?.images ?? []).filter(
			(image) => !builtins.some((p) => p.name === image.name),
		),
	];
	if (images.length === 0) {
		return null;
	}

	const choose = async (image: GalleryImage) => {
		const builtin = builtins.find((p) => p.name === image.name);
		if (builtin && onPickBuiltin) {
			onSelect?.(image.name);
			onPickBuiltin(builtin);
			return;
		}
		setLoading(image.name);
		try {
			const blob = await (
				await fetch(image.url, { credentials: "same-origin" })
			).blob();
			onSelect?.(image.name);
			onPick(new File([blob], image.name, { type: image.type }));
		} finally {
			setLoading(undefined);
		}
	};

	return (
		<div className="flex flex-col gap-2" data-testid="gallery-picker">
			<span className="text-sm text-content-secondary">{label}</span>
			<div
				role="radiogroup"
				aria-label="Provided pictures"
				className="flex flex-wrap gap-2.5"
			>
				{images.map((image) => (
					<button
						key={image.name}
						type="button"
						role="radio"
						aria-checked={selected === image.name}
						aria-label={image.name}
						title={image.name}
						disabled={disabled || loading !== undefined}
						onClick={() => void choose(image)}
						className={cn(
							"flex cursor-pointer items-center justify-center overflow-hidden border border-solid border-border p-1.5 transition-colors",
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
							src={image.url}
							alt=""
							className={cn(
								"max-h-full max-w-full",
								tile === "round"
									? "size-full rounded-full object-cover"
									: "object-contain",
							)}
						/>
					</button>
				))}
			</div>
		</div>
	);
};
