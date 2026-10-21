import { isEmbeddedFrame } from "./platformBoot";

/** The frame as the page inside it sees it: an element of the page around it (another window's HTMLIFrameElement). */
const framedBy = (frame: object | null) =>
	Object.defineProperty(window, "frameElement", {
		value: frame,
		configurable: true,
	});

describe("isEmbeddedFrame", () => {
	afterEach(() => framedBy(null));

	it("knows a dashboard page in the platform's frame, though the frame is another window's element", () => {
		framedBy({ tagName: "IFRAME", dataset: { platformEmbed: "/@admin/look" } });
		expect(isEmbeddedFrame()).toBe(true);
	});

	it("is false at the top, in a frame of anyone else, or in one not marked as the platform's", () => {
		framedBy(null);
		expect(isEmbeddedFrame()).toBe(false);
		framedBy({ tagName: "IFRAME", dataset: {} });
		expect(isEmbeddedFrame()).toBe(false);
		framedBy({ tagName: "OBJECT", dataset: { platformEmbed: "/" } });
		expect(isEmbeddedFrame()).toBe(false);
	});
});
