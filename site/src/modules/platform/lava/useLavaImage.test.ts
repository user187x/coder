import { renderHook, waitFor } from "@testing-library/react";
import { LAVA_PICTURE_DEFAULT } from "./lava";
import { withLavaSettings } from "./lavaPng";
import { useLavaImage } from "./useLavaImage";

const dataUrl = (bytes: Uint8Array) =>
	`data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;

const PLAIN_PNG = Uint8Array.from([
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
	0,
	0,
	0,
	13,
	0x49,
	0x48,
	0x44,
	0x52,
	...new Array(17).fill(0),
	0,
	0,
	0,
	0,
	0x49,
	0x44,
	0x41,
	0x54,
	0,
	0,
	0,
	0,
]);

describe("useLavaImage", () => {
	it("finds a lava picture's settings, so it is drawn live", async () => {
		const src = dataUrl(withLavaSettings(PLAIN_PNG, LAVA_PICTURE_DEFAULT));
		const { result } = renderHook(() => useLavaImage(src));
		await waitFor(() => expect(result.current).toEqual(LAVA_PICTURE_DEFAULT));
	});

	it("leaves any other picture alone, without fetching another site's", async () => {
		const fetchSpy = vi.spyOn(window, "fetch");
		const { result } = renderHook(() => [
			useLavaImage(dataUrl(PLAIN_PNG)),
			useLavaImage("https://example.com/avatar.png"),
		]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(result.current).toEqual([undefined, undefined]);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
