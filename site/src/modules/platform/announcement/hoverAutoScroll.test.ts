import {
	attachHoverAutoScroll,
	BACK_MS,
	READ_DELAY_MS,
} from "./hoverAutoScroll";

describe("attachHoverAutoScroll", () => {
	beforeEach(() =>
		vi.useFakeTimers({
			toFake: [
				"setTimeout",
				"clearTimeout",
				"requestAnimationFrame",
				"cancelAnimationFrame",
				"performance",
			],
		}),
	);
	afterEach(() => vi.useRealTimers());

	const box = (scrollHeight: number, clientHeight: number) => {
		const el = document.createElement("div");
		Object.defineProperty(el, "scrollHeight", { value: scrollHeight });
		Object.defineProperty(el, "clientHeight", { value: clientHeight });
		let top = 0;
		Object.defineProperty(el, "scrollTop", {
			get: () => top,
			set: (v: number) => {
				top = Math.max(0, Math.min(v, scrollHeight - clientHeight));
			},
		});
		return el;
	};

	it("hovered, a long message scrolls down slowly to its end; left, back up quickly", () => {
		const el = box(300, 36);
		const off = attachHoverAutoScroll(el);
		el.dispatchEvent(new PointerEvent("pointerenter"));
		vi.advanceTimersByTime(READ_DELAY_MS + 1000);
		const after1s = el.scrollTop;
		expect(after1s).toBeGreaterThan(10);
		expect(after1s).toBeLessThan(40); // slowly: about a line a second
		vi.advanceTimersByTime(30_000);
		expect(el.scrollTop).toBe(264); // the end
		el.dispatchEvent(new PointerEvent("pointerleave"));
		vi.advanceTimersByTime(BACK_MS + 50);
		expect(el.scrollTop).toBe(0);
		off();
	});

	it("a message that all shows does not move; the wheel hands it to the reader", () => {
		const short = box(30, 36);
		attachHoverAutoScroll(short);
		short.dispatchEvent(new PointerEvent("pointerenter"));
		vi.advanceTimersByTime(5000);
		expect(short.scrollTop).toBe(0);
		const long = box(300, 36);
		attachHoverAutoScroll(long);
		long.dispatchEvent(new PointerEvent("pointerenter"));
		vi.advanceTimersByTime(READ_DELAY_MS + 1000);
		long.dispatchEvent(new WheelEvent("wheel"));
		const at = long.scrollTop;
		vi.advanceTimersByTime(3000);
		expect(long.scrollTop).toBe(at);
	});
});
