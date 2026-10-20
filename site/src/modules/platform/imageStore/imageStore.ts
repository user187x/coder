import { useQuery } from "react-query";
import { PlatformAPI, type StoreImage } from "#/api/platform";
import {
	BANNER_PRESET_PICTURES,
	PREBAKED_BACKGROUNDS,
	PREBAKED_GALLERY,
	type PrebakedPicture,
} from "../pictures";

export const imageStoreKey = ["platform", "image-store"] as const;

/** The pictures baked into the dashboard itself (site/static/pictures/), as the store lists pictures. */
const asStore = (p: PrebakedPicture): StoreImage => ({
	...p,
	source: "dashboard",
});

/** An image's address without its version: what a choice that keeps a reference stores. */
export const referenceOf = (image: Pick<StoreImage, "url">) =>
	image.url.split("?")[0];

/** Whether a choice may keep the picture as a reference (it is there wherever the dashboard is), not a copy. */
export const isBaked = (image: Pick<StoreImage, "source">) =>
	image.source === "store" || image.source === "dashboard";

/**
 * The image store as one list: a chooser's own presets first (extra), then the pictures baked into the platform
 * service's image (the store's), the rest baked into the dashboard, the gallery's and the uploaded ones - each once.
 */
export const mergeImages = (
	extra: readonly PrebakedPicture[],
	served: readonly StoreImage[],
): StoreImage[] => {
	const dashboard = [
		...PREBAKED_BACKGROUNDS,
		...BANNER_PRESET_PICTURES,
		...PREBAKED_GALLERY,
	];
	const ordered: StoreImage[] = [
		...extra.map(asStore),
		...served.filter((i) => i.source === "store"),
		...dashboard.map(asStore),
		...served.filter((i) => i.source !== "store"),
	];
	const seen = new Set<string>();
	const names = new Set<string>();
	return ordered.filter((image) => {
		const key = referenceOf(image);
		// the gallery may hold a picture the dashboard has baked in already: the same name, once
		if (
			seen.has(key) ||
			(image.source === "gallery" && names.has(image.name))
		) {
			return false;
		}
		seen.add(key);
		names.add(image.name);
		return true;
	});
};

/** Every picture a chooser offers (the image store), its own presets first. */
export const useImageStore = (extra: readonly PrebakedPicture[] = []) => {
	const query = useQuery({
		queryKey: imageStoreKey,
		queryFn: PlatformAPI.getImageStore,
		staleTime: 60_000,
	});
	return {
		images: mergeImages(extra, query.data?.images ?? []),
		isLoading: query.isLoading,
	};
};

/** A store picture as a file, for a chooser that takes a file (an avatar, a logo, an icon: resized from it). */
export const fetchStoreImage = async (image: StoreImage): Promise<File> => {
	const blob = await (
		await fetch(image.url, { credentials: "same-origin" })
	).blob();
	return new File([blob], image.name, { type: image.type || blob.type });
};
