import { attachAnnouncementAutoScroll, READ_DELAY_MS } from "./hoverAutoScroll";

describe("announcement auto scroll", () => {
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
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		delete document.documentElement.dataset.animations;
	});

	const box = (scrollHeight: number, clientHeight: number) => {
		const el = document.createElement("div");
		Object.defineProperty(el, "scrollHeight", { value: scrollHeight });
		Object.defineProperty(el, "clientHeight", { value: clientHeight });
		return el;
	};

	it("automatically reads overflowing text very slowly to its end without hovering", () => {
		const el = box(100, 36);
		const off = attachAnnouncementAutoScroll(el);
		vi.advanceTimersByTime(READ_DELAY_MS + 1000);
		expect(el.scrollTop).toBeGreaterThan(3);
		expect(el.scrollTop).toBeLessThan(5);
		vi.advanceTimersByTime(30_000);
		expect(el.scrollTop).toBe(64);
		off();
	});

	it.each(["pointerup", "pointercancel", "blur"])(
		"holds its position while pressed and resumes after %s outside the banner",
		(release) => {
			const el = box(300, 36);
			const off = attachAnnouncementAutoScroll(el);
			vi.advanceTimersByTime(READ_DELAY_MS + 1000);
			el.dispatchEvent(new PointerEvent("pointerdown"));
			const held = el.scrollTop;
			el.dispatchEvent(new PointerEvent("pointerleave"));
			vi.advanceTimersByTime(5000);
			expect(el.scrollTop).toBe(held);
			window.dispatchEvent(new Event(release));
			vi.advanceTimersByTime(READ_DELAY_MS + 1000);
			expect(el.scrollTop).toBeGreaterThan(held);
			off();
		},
	);

	it("hands scrolling to a reader who uses the wheel and cancels its work on cleanup", () => {
		const el = box(300, 36);
		const off = attachAnnouncementAutoScroll(el);
		vi.advanceTimersByTime(READ_DELAY_MS + 1000);
		el.dispatchEvent(new WheelEvent("wheel"));
		const at = el.scrollTop;
		vi.advanceTimersByTime(3000);
		expect(el.scrollTop).toBe(at);
		off();
		window.dispatchEvent(new Event("pointerup"));
		vi.advanceTimersByTime(3000);
		expect(el.scrollTop).toBe(at);
	});

	it("does not move short announcements or override reduced motion", () => {
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: true })),
		);
		const el = box(300, 36);
		const off = attachAnnouncementAutoScroll(el);
		vi.advanceTimersByTime(10_000);
		expect(el.scrollTop).toBe(0);
		off();
		vi.unstubAllGlobals();
		const short = box(30, 36);
		const stop = attachAnnouncementAutoScroll(short);
		vi.advanceTimersByTime(10_000);
		expect(short.scrollTop).toBe(0);
		stop();
	});

	it("stops when animations are disabled and resumes when enabled", async () => {
		const el = box(300, 36);
		const off = attachAnnouncementAutoScroll(el);
		vi.advanceTimersByTime(READ_DELAY_MS + 1000);
		document.documentElement.dataset.animations = "off";
		await Promise.resolve();
		const at = el.scrollTop;
		vi.advanceTimersByTime(10_000);
		expect(el.scrollTop).toBe(at);
		document.documentElement.dataset.animations = "on";
		await Promise.resolve();
		vi.advanceTimersByTime(READ_DELAY_MS + 1000);
		expect(el.scrollTop).toBeGreaterThan(at);
		off();
	});
});

describe("continuous announcement text", () => {
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
	it("continues from the end into its duplicate and wraps without stopping", () => {
		const viewport = document.createElement("div");
		Object.defineProperty(viewport, "scrollHeight", { value: 200 });
		Object.defineProperty(viewport, "clientHeight", { value: 36 });
		const source = document.createElement("span");
		source.setAttribute("data-banner-loop-source", "");
		vi.spyOn(source, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 200, 100),
		);
		viewport.append(source);
		const off = attachAnnouncementAutoScroll(viewport, () => viewport, true);
		vi.advanceTimersByTime(READ_DELAY_MS + 26_000);
		expect(viewport.scrollTop).toBeGreaterThan(2);
		expect(viewport.scrollTop).toBeLessThan(6);
		const before = viewport.scrollTop;
		viewport.dispatchEvent(new PointerEvent("pointerdown"));
		vi.advanceTimersByTime(5000);
		expect(viewport.scrollTop).toBe(before);
		window.dispatchEvent(new PointerEvent("pointerup"));
		vi.advanceTimersByTime(READ_DELAY_MS + 1000);
		expect(viewport.scrollTop).toBeGreaterThan(before);
		off();
	});
});
