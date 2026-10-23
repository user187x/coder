// Platform: an announcement too long to see at once reads itself on hover - the pointer resting on it scrolls it down
// slowly, at a reading pace, to its end; the pointer leaving brings it back up to its beginning, quickly. Turning the
// wheel while it scrolls hands it to the reader (it stops following).

/** Pixels a second, down: about a line every second. */
export const READ_PX_PER_SECOND = 20;
/** A moment to start reading before it moves. */
export const READ_DELAY_MS = 600;
/** Back up to the beginning. */
export const BACK_MS = 350;

/**
 * On `hover` (the element the pointer rests on), scrolls `scroller()` (the element that overflows: the same one, or
 * one inside it, found when the pointer arrives). The function it returns takes it off.
 */
export const attachHoverAutoScroll = (
	hover: HTMLElement,
	scroller: () => HTMLElement | null = () => hover,
): (() => void) => {
	let frame = 0;
	let delay = 0;
	let target: HTMLElement | null = null;
	const stop = () => {
		cancelAnimationFrame(frame);
		window.clearTimeout(delay);
		frame = 0;
	};
	const down = () => {
		const el = target;
		if (!el) {
			return;
		}
		let last = performance.now();
		let position = el.scrollTop;
		const step = (now: number) => {
			position += (READ_PX_PER_SECOND * (now - last)) / 1000;
			last = now;
			const end = el.scrollHeight - el.clientHeight;
			el.scrollTop = Math.min(position, end);
			frame = position < end ? requestAnimationFrame(step) : 0;
		};
		frame = requestAnimationFrame(step);
	};
	const up = () => {
		const el = target;
		if (!el || el.scrollTop <= 0) {
			return;
		}
		const from = el.scrollTop;
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min((now - start) / BACK_MS, 1);
			el.scrollTop = from * (1 - (1 - (1 - t) ** 3)); // ease out
			frame = t < 1 ? requestAnimationFrame(step) : 0;
		};
		frame = requestAnimationFrame(step);
	};
	const onEnter = () => {
		stop();
		target = scroller();
		if (!target || target.scrollHeight - target.clientHeight <= 2) {
			return; // it all shows: nothing to read further
		}
		delay = window.setTimeout(down, READ_DELAY_MS);
	};
	const onLeave = () => {
		stop();
		up();
	};
	const onWheel = () => stop();
	hover.addEventListener("pointerenter", onEnter);
	hover.addEventListener("pointerleave", onLeave);
	hover.addEventListener("wheel", onWheel, { passive: true });
	return () => {
		stop();
		hover.removeEventListener("pointerenter", onEnter);
		hover.removeEventListener("pointerleave", onLeave);
		hover.removeEventListener("wheel", onWheel);
	};
};
