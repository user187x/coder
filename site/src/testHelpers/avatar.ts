import { LAVA_PICTURE_DEFAULT } from "#/components/LavaImage/lava";
import { withLavaSettings } from "#/components/LavaImage/lavaPng";

const pixels = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHfoAAAAASUVORK5CYII=",
	),
	(c) => c.charCodeAt(0),
);
export const MockLavaAvatar = `data:image/png;base64,${btoa(String.fromCharCode(...withLavaSettings(pixels, LAVA_PICTURE_DEFAULT)))}`;
