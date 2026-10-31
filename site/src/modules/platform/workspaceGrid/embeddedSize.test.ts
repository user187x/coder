import { act, renderHook } from "@testing-library/react";
import { MockResizeObserver } from "#/testHelpers/resizeObserver";
import {
	EMBED_SIZE_MESSAGE,
	isEmbedSizeMessage,
	useReportEmbeddedSize,
} from "./embeddedSize";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("reports changed intrinsic sizes once and disconnects when unmounted", () => {
	MockResizeObserver.reset();
	vi.stubGlobal("ResizeObserver", MockResizeObserver);
	const element = document.createElement("div");
	const height = vi.spyOn(element, "offsetHeight", "get").mockReturnValue(300);
	vi.spyOn(element, "scrollWidth", "get").mockReturnValue(1024);
	const post = vi
		.spyOn(window.parent, "postMessage")
		.mockImplementation(() => {});
	const { unmount } = renderHook(() =>
		useReportEmbeddedSize({ current: element }, true),
	);
	expect(post).toHaveBeenCalledExactlyOnceWith(
		{ type: EMBED_SIZE_MESSAGE, width: 1024, height: 300 },
		window.location.origin,
	);
	act(() => MockResizeObserver.getLast().simulateResize(1024, 300));
	expect(post).toHaveBeenCalledTimes(1);
	height.mockReturnValue(700);
	act(() => MockResizeObserver.getLast().simulateResize(1024, 700));
	expect(post).toHaveBeenLastCalledWith(
		{ type: EMBED_SIZE_MESSAGE, width: 1024, height: 700 },
		window.location.origin,
	);
	unmount();
	expect(MockResizeObserver.getLast().disconnect).toHaveBeenCalledOnce();
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, "300"])(
	"rejects invalid frame dimensions: %s",
	(size) => {
		expect(
			isEmbedSizeMessage({
				type: EMBED_SIZE_MESSAGE,
				width: 1024,
				height: size,
			}),
		).toBe(false);
		expect(
			isEmbedSizeMessage({
				type: EMBED_SIZE_MESSAGE,
				width: size,
				height: 300,
			}),
		).toBe(false);
	},
);
