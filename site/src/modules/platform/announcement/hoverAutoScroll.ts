/** A line takes several seconds, leaving time to read it before it moves away. */
export const READ_PX_PER_SECOND = 4;
export const READ_DELAY_MS = 2000;

/** Reads overflowing announcements automatically; holding the pointer pauses at the current position. */
export const attachAnnouncementAutoScroll = (
	hover: HTMLElement,
	scroller: () => HTMLElement | null = () => hover,
	loop = false,
): (() => void) => {
	let frame = 0;
	let delay = 0;
	let held = false;
	let manual = false;
	const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
	const enabled = () =>
		document.documentElement.dataset.animations !== "off" &&
		!reducedMotion?.matches;
	const stop = () => {
		cancelAnimationFrame(frame);
		window.clearTimeout(delay);
		frame = 0;
	};
	const down = () => {
		const el = scroller();
		if (!el || !enabled() || held || manual) {
			return;
		}
		let last = performance.now();
		let position = el.scrollTop;
		const step = (now: number) => {
			position += (READ_PX_PER_SECOND * Math.min(now - last, 100)) / 1000;
			last = now;
			const end = Math.max(0, el.scrollHeight - el.clientHeight);
			const source = loop
				? el.querySelector<HTMLElement>("[data-banner-loop-source]")
				: null;
			const period = source?.getBoundingClientRect().height ?? 0;
			const cycling = loop && period > el.clientHeight;
			if (cycling) position %= period;
			el.scrollTop = cycling ? position : Math.min(position, end);
			frame = cycling || position < end ? requestAnimationFrame(step) : 0;
		};
		frame = requestAnimationFrame(step);
	};
	const resume = () => {
		stop();
		if (enabled() && !held && !manual) {
			delay = window.setTimeout(down, READ_DELAY_MS);
		}
	};
	const pause = () => {
		held = true;
		stop();
	};
	const release = () => {
		if (held) {
			held = false;
			resume();
		}
	};
	const wheel = () => {
		manual = true;
		stop();
	};
	const preferenceChanged = () => resume();
	const observer = new MutationObserver(preferenceChanged);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-animations"],
	});
	hover.addEventListener("pointerdown", pause);
	hover.addEventListener("wheel", wheel, { passive: true });
	hover.addEventListener("keydown", wheel);
	window.addEventListener("pointerup", release);
	window.addEventListener("pointercancel", release);
	window.addEventListener("blur", release);
	reducedMotion?.addEventListener?.("change", preferenceChanged);
	resume();
	return () => {
		stop();
		observer.disconnect();
		hover.removeEventListener("pointerdown", pause);
		hover.removeEventListener("wheel", wheel);
		hover.removeEventListener("keydown", wheel);
		window.removeEventListener("pointerup", release);
		window.removeEventListener("pointercancel", release);
		window.removeEventListener("blur", release);
		reducedMotion?.removeEventListener?.("change", preferenceChanged);
	};
};
