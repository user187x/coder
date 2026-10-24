import type { StoreImage } from "#/api/platform";
import {
	PREBAKED_BACKGROUNDS,
	PREBAKED_GALLERY,
} from "#/modules/platform/pictures";

const pictures = [...PREBAKED_BACKGROUNDS, ...PREBAKED_GALLERY];

export const MockImageStoreImages: readonly StoreImage[] = Array.from(
	{ length: 48 },
	(_, index) => {
		const picture = pictures[index % pictures.length];
		return {
			name: `${index + 1}-${picture.name}`,
			url: `${picture.url}?preview=${index}`,
			type: picture.type,
			source: "dashboard",
		};
	},
);
